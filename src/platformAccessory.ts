import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { ExampleHomebridgePlatform } from './platform.js';

type AiperMode = 'Smart' | 'Floor' | 'Wall' | 'Waterline';

export class ExamplePlatformAccessory {
  private smartService: Service;
  private floorService: Service;
  private wallService: Service;
  private waterlineService: Service;
  private batteryService: Service;

  private activeMode?: AiperMode;

  constructor(
    private readonly platform: ExampleHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const displayName = 'Scuba N1 Max';
    const serialNumber = this.accessory.context.device?.serialNumber ?? 'T1D55200156';

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Aiper')
      .setCharacteristic(this.platform.Characteristic.Model, 'Scuba N1 Max')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, serialNumber)
      .setCharacteristic(this.platform.Characteristic.Name, displayName);

    this.smartService = this.setupModeSwitch('Smart', 'smart');
    this.floorService = this.setupModeSwitch('Floor', 'floor');
    this.wallService = this.setupModeSwitch('Wall', 'wall');
    this.waterlineService = this.setupModeSwitch('Waterline', 'waterline');

    this.batteryService =
      this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery);

    this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .onGet(async () => this.platform.aiperClient.latestBattery);

    this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(async () =>
        this.platform.aiperClient.latestBattery <= 20
          ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
          : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      );
    this.batteryService
      .setCharacteristic(this.platform.Characteristic.Name, 'Battery')
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Battery');

    this.platform.log.info('Loaded Aiper accessory:', displayName);
  }

  private setupModeSwitch(mode: AiperMode, subtype: string): Service {
    const service =
      this.accessory.getService(mode) ||
      this.accessory.addService(this.platform.Service.Switch, mode, subtype);

    service
      .setCharacteristic(this.platform.Characteristic.Name, mode)
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, mode);

    service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async value => this.setMode(mode, value))
      .onGet(async () => this.activeMode === mode);

    return service;
  }

  private updateModeSwitches(): void {
    this.smartService.updateCharacteristic(this.platform.Characteristic.On, this.activeMode === 'Smart');
    this.floorService.updateCharacteristic(this.platform.Characteristic.On, this.activeMode === 'Floor');
    this.wallService.updateCharacteristic(this.platform.Characteristic.On, this.activeMode === 'Wall');
    this.waterlineService.updateCharacteristic(this.platform.Characteristic.On, this.activeMode === 'Waterline');
  }

  private async setMode(mode: AiperMode, value: CharacteristicValue): Promise<void> {
    const nextOn = value as boolean;

    if (nextOn) {
      if (this.activeMode === mode) {
        return;
      }

      this.activeMode = mode;
      this.updateModeSwitches();

      this.platform.log.info(`Aiper mode selected: ${mode}`);
      await this.platform.aiperClient.startMode(mode);
      return;
    }

    if (this.activeMode !== mode) {
      return;
    }

    this.activeMode = undefined;
    this.updateModeSwitches();

    this.platform.log.info(`Aiper mode stopped: ${mode}`);
    await this.platform.aiperClient.stop();
  }
}