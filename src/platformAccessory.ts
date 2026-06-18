import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { ExampleHomebridgePlatform } from './platform.js';

export class ExamplePlatformAccessory {
  private smartService: Service;
  private floorService: Service;
  private wallService: Service;
  private batteryService: Service;

  private states = {
    Smart: false,
    Floor: false,
    Wall: false,
    BatteryLevel: 100,
    ChargingState: 0,
  };

  constructor(
    private readonly platform: ExampleHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Aiper')
      .setCharacteristic(this.platform.Characteristic.Model, 'Scuba N1 Max')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device?.serialNumber ?? 'AIPER-SCUBA-N1-MAX-001')
      .setCharacteristic(this.platform.Characteristic.Name, accessory.context.device?.displayName ?? 'Scuba N1 Max');

    this.smartService =
      this.accessory.getService('Smart') ||
      this.accessory.addService(this.platform.Service.Switch, 'Smart', 'smart');

    this.floorService =
      this.accessory.getService('Floor') ||
      this.accessory.addService(this.platform.Service.Switch, 'Floor', 'floor');

    this.wallService =
      this.accessory.getService('Wall') ||
      this.accessory.addService(this.platform.Service.Switch, 'Wall', 'wall');

    this.smartService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setSmart.bind(this))
      .onGet(async () => this.states.Smart);

    this.floorService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setFloor.bind(this))
      .onGet(async () => this.states.Floor);

    this.wallService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setWall.bind(this))
      .onGet(async () => this.states.Wall);

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

  private turnOffOtherModes(activeMode: 'Smart' | 'Floor' | 'Wall') {
    this.states.Smart = activeMode === 'Smart';
    this.states.Floor = activeMode === 'Floor';
    this.states.Wall = activeMode === 'Wall';

    this.smartService.updateCharacteristic(this.platform.Characteristic.On, this.states.Smart);
    this.floorService.updateCharacteristic(this.platform.Characteristic.On, this.states.Floor);
    this.wallService.updateCharacteristic(this.platform.Characteristic.On, this.states.Wall);
  }

  async setSmart(value: CharacteristicValue): Promise<void> {
    const isOn = value as boolean;

    if (isOn) {
      this.turnOffOtherModes('Smart');
      this.platform.log.info('Aiper mode selected: Smart');
    } else {
      this.states.Smart = false;
      this.platform.log.info('Aiper Smart mode stopped');
    }
  }

  async setFloor(value: CharacteristicValue): Promise<void> {
    const isOn = value as boolean;

    if (isOn) {
      this.turnOffOtherModes('Floor');
      this.platform.log.info('Aiper mode selected: Floor');
    } else {
      this.states.Floor = false;
      this.platform.log.info('Aiper Floor mode stopped');
    }
  }

  async setWall(value: CharacteristicValue): Promise<void> {
    const isOn = value as boolean;

    if (isOn) {
      this.turnOffOtherModes('Wall');
      this.platform.log.info('Aiper mode selected: Wall');
    } else {
      this.states.Wall = false;
      this.platform.log.info('Aiper Wall mode stopped');
    }
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