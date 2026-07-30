import type {
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';

import type { ExampleHomebridgePlatform } from './platform.js';

type AiperMode = 'Smart' | 'Floor' | 'Wall' | 'Waterline';

export class ExamplePlatformAccessory {
  private smartService?: Service;
  private floorService?: Service;
  private wallService?: Service;
  private waterlineService?: Service;
  private batteryService?: Service;
  private cycleCompleteDoorbell?: Service;

  private activeMode?: AiperMode;

  constructor(
    private readonly platform: ExampleHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const device = this.accessory.context.device;
    const displayName = device?.displayName ?? 'Scuba N1 Max';
    const mode = device?.mode ?? 'Main';
    const serialNumber =
      device?.serialNumber ??
      this.platform.config.deviceId ??
      'Unknown';

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        'Aiper',
      )
      .setCharacteristic(
        this.platform.Characteristic.Model,
        'Scuba N1 Max',
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        serialNumber,
      )
      .setCharacteristic(
        this.platform.Characteristic.Name,
        displayName,
      );

    if (mode === 'Battery') {
      this.setupBatteryAccessory();
    } else {
      this.setupControlsAccessory();
    }

    this.platform.log.info('Loaded Aiper accessory:', displayName);
  }

  private setupControlsAccessory(): void {
    this.smartService = this.setupModeSwitch('Smart', 'smart');
    this.floorService = this.setupModeSwitch('Floor', 'floor');
    this.wallService = this.setupModeSwitch('Wall', 'wall');
    this.waterlineService = this.setupModeSwitch(
      'Waterline',
      'waterline',
    );

    this.setupCycleCompleteDoorbell();
  }

  private setupCycleCompleteDoorbell(): void {
    const serviceName = 'Aiper Cycle Complete';
    const subtype = 'aiper-cycle-complete';

    this.cycleCompleteDoorbell =
      this.accessory.getServiceById(
        this.platform.Service.Doorbell,
        subtype,
      ) ??
      this.accessory.addService(
        this.platform.Service.Doorbell,
        serviceName,
        subtype,
      );

    this.cycleCompleteDoorbell.setCharacteristic(
      this.platform.Characteristic.Name,
      serviceName,
    );

    this.platform.aiperClient.onCycleComplete(() => {
      this.ringCycleCompleteDoorbell();
    });

    this.platform.log.info(
      'Aiper cycle-complete HomeKit doorbell loaded.',
    );
  }

  private ringCycleCompleteDoorbell(): void {
    if (!this.cycleCompleteDoorbell) {
      this.platform.log.warn(
        'Aiper cycle-complete doorbell service is unavailable.',
      );
      return;
    }

    this.platform.log.info(
      'Aiper cleaner is waiting at the waterline. Sending HomeKit notification.',
    );

    this.cycleCompleteDoorbell.updateCharacteristic(
      this.platform.Characteristic.ProgrammableSwitchEvent,
      this.platform.Characteristic
        .ProgrammableSwitchEvent.SINGLE_PRESS,
    );
  }
  private setupBatteryAccessory(): void {
    this.batteryService =
      this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery);

    this.batteryService
      .setCharacteristic(
        this.platform.Characteristic.Name,
        'Battery',
      )
      .setCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        'Battery',
      );

    this.batteryService
      .getCharacteristic(
        this.platform.Characteristic.BatteryLevel,
      )
      .onGet(
        async () => this.platform.aiperClient.latestBattery,
      );

    this.batteryService
      .getCharacteristic(
        this.platform.Characteristic.StatusLowBattery,
      )
      .onGet(async () =>
        this.platform.aiperClient.latestBattery <= 20
          ? this.platform.Characteristic.StatusLowBattery
            .BATTERY_LEVEL_LOW
          : this.platform.Characteristic.StatusLowBattery
            .BATTERY_LEVEL_NORMAL,
      );

    this.batteryService
      .getCharacteristic(
        this.platform.Characteristic.ChargingState,
      )
      .onGet(
        async () =>
          this.platform.Characteristic.ChargingState
            .NOT_CHARGING,
      );

    this.batteryService.updateCharacteristic(
      this.platform.Characteristic.BatteryLevel,
      this.platform.aiperClient.latestBattery,
    );

    this.batteryService.updateCharacteristic(
      this.platform.Characteristic.StatusLowBattery,
      this.platform.aiperClient.latestBattery <= 20
        ? this.platform.Characteristic.StatusLowBattery
          .BATTERY_LEVEL_LOW
        : this.platform.Characteristic.StatusLowBattery
          .BATTERY_LEVEL_NORMAL,
    );

    this.batteryService.updateCharacteristic(
      this.platform.Characteristic.ChargingState,
      this.platform.Characteristic.ChargingState.NOT_CHARGING,
    );
  }

  private setupModeSwitch(
    mode: AiperMode,
    subtype: string,
  ): Service {
    const service =
      this.accessory.getService(mode) ||
      this.accessory.addService(
        this.platform.Service.Switch,
        mode,
        subtype,
      );

    service
      .setCharacteristic(
        this.platform.Characteristic.Name,
        mode,
      )
      .setCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        mode,
      );

    service
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet(async value => this.setMode(mode, value))
      .onGet(async () => this.activeMode === mode);

    return service;
  }

  private updateModeSwitches(): void {
    this.smartService?.updateCharacteristic(
      this.platform.Characteristic.On,
      this.activeMode === 'Smart',
    );

    this.floorService?.updateCharacteristic(
      this.platform.Characteristic.On,
      this.activeMode === 'Floor',
    );

    this.wallService?.updateCharacteristic(
      this.platform.Characteristic.On,
      this.activeMode === 'Wall',
    );

    this.waterlineService?.updateCharacteristic(
      this.platform.Characteristic.On,
      this.activeMode === 'Waterline',
    );
  }

  private async setMode(
    mode: AiperMode,
    value: CharacteristicValue,
  ): Promise<void> {
    const nextOn = value as boolean;

    if (nextOn) {
      if (this.activeMode === mode) {
        return;
      }

      this.activeMode = mode;
      this.updateModeSwitches();

      this.platform.log.info(
        `Aiper mode selected: ${mode}`,
      );

      await this.platform.aiperClient.startMode(mode);
      return;
    }

    if (this.activeMode !== mode) {
      return;
    }

    this.activeMode = undefined;
    this.updateModeSwitches();

    this.platform.log.info(
      `Aiper mode stopped: ${mode}`,
    );

    await this.platform.aiperClient.stop();
  }
}