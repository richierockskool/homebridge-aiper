import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { ExampleHomebridgePlatform } from './platform.js';

export class ExamplePlatformAccessory {
  private switchService: Service;
  private batteryService: Service;

  private states = {
    On: false,
    BatteryLevel: 100,
    ChargingState: 0,
  };

  constructor(
    private readonly platform: ExampleHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Aiper')
      .setCharacteristic(this.platform.Characteristic.Model, 'Scuba Aiper Max')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device?.serialNumber ?? 'AIPER-SCUBA-MAX-001')
      .setCharacteristic(this.platform.Characteristic.Name, accessory.context.device?.displayName ?? 'Scuba Aiper Max');

    this.switchService =
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);

    this.switchService.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.context.device?.displayName ?? 'Scuba Aiper Max',
    );

    this.switchService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    this.batteryService =
      this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery);

    this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this));

    this.batteryService.getCharacteristic(this.platform.Characteristic.ChargingState)
      .onGet(this.getChargingState.bind(this));

    this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(this.getStatusLowBattery.bind(this));

    this.platform.log.info('Loaded Aiper accessory:', accessory.displayName);
  }

  async setOn(value: CharacteristicValue): Promise<void> {
    this.states.On = value as boolean;

    if (this.states.On) {
      this.platform.log.info('Aiper Scuba Max cleaning started');
      // Later: call Aiper cloud/API start-clean command here
    } else {
      this.platform.log.info('Aiper Scuba Max cleaning stopped');
      // Later: call Aiper cloud/API stop/dock command here
    }
  }

  async getOn(): Promise<CharacteristicValue> {
    this.platform.log.debug('Get Aiper On ->', this.states.On);
    return this.states.On;
  }

  async getBatteryLevel(): Promise<CharacteristicValue> {
    return this.states.BatteryLevel;
  }

  async getChargingState(): Promise<CharacteristicValue> {
    return this.states.ChargingState;
  }

  async getStatusLowBattery(): Promise<CharacteristicValue> {
    return this.states.BatteryLevel <= 20
      ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  }
}