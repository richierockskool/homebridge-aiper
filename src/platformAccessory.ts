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
  private mayBeStuckDoorbell?: Service;

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

    switch (mode) {
    case 'Battery':
      this.setupBatteryAccessory();
      break;

    case 'CycleComplete':
      this.setupCycleCompleteDoorbell();
      break;

    case 'MayBeStuck':
      this.setupMayBeStuckDoorbell();
      break;

    default:
      this.setupControlsAccessory();
      break;
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

    this.platform.aiperClient.onStateUpdate(state => {
      let reportedMode: AiperMode | undefined;

      switch (state.mode) {
      case 1:
        reportedMode = 'Smart';
        break;

      case 2:
        reportedMode = 'Floor';
        break;

      case 3:
        reportedMode = 'Wall';
        break;

      case 4:
        reportedMode = 'Waterline';
        break;

      default:
      /*
       * Ignore mode=0 here.
       *
       * The Aiper reports mode=0 temporarily while waking,
       * transitioning between modes, and returning to idle.
       * We do not want those temporary reports turning all
       * HomeKit switches off.
       */
        return;
      }

      if (this.activeMode === reportedMode) {
        return;
      }

      this.activeMode = reportedMode;

      this.platform.log.info(
        `Aiper confirmed mode: ${reportedMode}`,
      );

      this.updateModeSwitches();
    });
  }
  private setupCycleCompleteDoorbell(): void {
    const serviceName = 'Aiper Has Finished the Job';

    /*
   * Remove the temporary MotionSensor service from our test version.
   */
    const oldSensor =
    this.accessory.getService(this.platform.Service.MotionSensor);

    if (oldSensor) {
      this.accessory.removeService(oldSensor);
    }

    this.cycleCompleteDoorbell =
    this.accessory.getService(this.platform.Service.Doorbell) ??
    this.accessory.addService(
      this.platform.Service.Doorbell,
      serviceName,
    );

    this.cycleCompleteDoorbell
      .setCharacteristic(
        this.platform.Characteristic.Name,
        serviceName,
      )
      .setCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        serviceName,
      );

    this.platform.aiperClient.onCycleComplete(() => {
      this.ringCycleCompleteDoorbell();
    });

    this.platform.log.info(
      'Aiper cycle-complete HomeKit doorbell loaded.',
    );
  }

  private setupMayBeStuckDoorbell(): void {
    const serviceName = 'Aiper May Be Stuck';

    /*
   * Remove the temporary MotionSensor service from our test version.
   */
    const oldSensor =
    this.accessory.getService(this.platform.Service.MotionSensor);

    if (oldSensor) {
      this.accessory.removeService(oldSensor);
    }

    this.mayBeStuckDoorbell =
    this.accessory.getService(this.platform.Service.Doorbell) ??
    this.accessory.addService(
      this.platform.Service.Doorbell,
      serviceName,
    );

    this.mayBeStuckDoorbell
      .setCharacteristic(
        this.platform.Characteristic.Name,
        serviceName,
      )
      .setCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        serviceName,
      );

    this.platform.aiperClient.onMayBeStuck(() => {
      this.ringMayBeStuckDoorbell();
    });

    this.platform.log.info(
      'Aiper may-be-stuck HomeKit doorbell loaded.',
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
      'Aiper has finished the job. Sending 3 HomeKit doorbell rings.',
    );

    const ringDoorbell = (ringNumber: number): void => {
      if (!this.cycleCompleteDoorbell) {
        return;
      }

      this.platform.log.info(
        `Aiper cycle-complete doorbell ring ${ringNumber} of 3.`,
      );

      this.cycleCompleteDoorbell.updateCharacteristic(
        this.platform.Characteristic.ProgrammableSwitchEvent,
        this.platform.Characteristic
          .ProgrammableSwitchEvent.SINGLE_PRESS,
      );
    };

    /*
   * Use wider spacing than before.
   *
   * The old 1.2 second spacing may have caused HomeKit/HomePod
   * to treat the events as one doorbell press.
   */
    ringDoorbell(1);

    setTimeout(() => {
      ringDoorbell(2);
    }, 4000);

    setTimeout(() => {
      ringDoorbell(3);
    }, 8000);
  }

  private ringMayBeStuckDoorbell(): void {
    if (!this.mayBeStuckDoorbell) {
      this.platform.log.warn(
        'Aiper may-be-stuck doorbell service is unavailable.',
      );
      return;
    }

    this.platform.log.warn(
      'Aiper has not returned after 3 hours. ' +
    'Sending 3 HomeKit warning rings.',
    );

    const ringDoorbell = (ringNumber: number): void => {
      if (!this.mayBeStuckDoorbell) {
        return;
      }

      this.platform.log.warn(
        `Aiper may-be-stuck doorbell ring ${ringNumber} of 3.`,
      );

      this.mayBeStuckDoorbell.updateCharacteristic(
        this.platform.Characteristic.ProgrammableSwitchEvent,
        this.platform.Characteristic
          .ProgrammableSwitchEvent.SINGLE_PRESS,
      );
    };

    ringDoorbell(1);

    setTimeout(() => {
      ringDoorbell(2);
    }, 4000);

    setTimeout(() => {
      ringDoorbell(3);
    }, 8000);
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
      .onGet(async () =>
        this.platform.aiperClient.latestCharging
          ? this.platform.Characteristic.ChargingState
            .CHARGING
          : this.platform.Characteristic.ChargingState
            .NOT_CHARGING,
      );

    this.platform.aiperClient.onStateUpdate(state => {
      if (!this.batteryService) {
        return;
      }

      const batteryLevel = Math.max(
        0,
        Math.min(100, state.battery),
      );

      this.batteryService.updateCharacteristic(
        this.platform.Characteristic.BatteryLevel,
        batteryLevel,
      );

      this.batteryService.updateCharacteristic(
        this.platform.Characteristic.StatusLowBattery,
        batteryLevel <= 20
          ? this.platform.Characteristic.StatusLowBattery
            .BATTERY_LEVEL_LOW
          : this.platform.Characteristic.StatusLowBattery
            .BATTERY_LEVEL_NORMAL,
      );
      this.batteryService.updateCharacteristic(
        this.platform.Characteristic.ChargingState,
        state.charging
          ? this.platform.Characteristic.ChargingState
            .CHARGING
          : this.platform.Characteristic.ChargingState
            .NOT_CHARGING,
      );
      this.platform.log.info(
        `Aiper HomeKit battery updated: ${batteryLevel}% ` +
  `charging=${state.charging}`,
      );
    });  
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
      this.platform.aiperClient.latestCharging
        ? this.platform.Characteristic.ChargingState.CHARGING
        : this.platform.Characteristic.ChargingState.NOT_CHARGING,
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

      /*
     * Update HomeKit immediately so the four mode controls behave
     * like radio buttons.
     */
      this.activeMode = mode;
      this.updateModeSwitches();

      this.platform.log.info(
        `Aiper mode selected: ${mode}`,
      );

      await this.platform.aiperClient.startMode(mode);
      return;
    }

    /*
   * Ignore OFF callbacks from switches that were turned off only
   * because another mode became active.
   *
   * This prevents HomeKit from sending AT+MODE=0 during a mode change.
   */
    if (this.activeMode !== mode) {
      return;
    }

    this.activeMode = undefined;

    this.platform.log.info(
      `Aiper mode stopped: ${mode}`,
    );

    await this.platform.aiperClient.stop();
  }
}