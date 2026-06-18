import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { ExampleHomebridgePlatform } from './platform.js';

export class ExamplePlatformAccessory {
  private switchService: Service;
  private isOn = false;

  constructor(
    private readonly platform: ExampleHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const device = this.accessory.context.device;
    const displayName = device?.displayName ?? 'Scuba N1 Max';
    const modeName = device?.mode ?? displayName;
    const serialNumber = device?.serialNumber ?? 'AIPER-SCUBA-N1-MAX-001';

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Aiper')
      .setCharacteristic(this.platform.Characteristic.Model, 'Scuba N1 Max')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, serialNumber)
      .setCharacteristic(this.platform.Characteristic.Name, displayName);

    this.switchService =
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);

    this.switchService.setCharacteristic(this.platform.Characteristic.Name, modeName);

    this.switchService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setMode.bind(this))
      .onGet(async () => this.isOn);

    this.platform.log.info('Loaded Aiper accessory:', displayName);
  }

  async setMode(value: CharacteristicValue): Promise<void> {
    this.isOn = value as boolean;

    const mode = this.accessory.context.device?.mode ?? 'Unknown';

    if (this.isOn) {
      this.platform.log.info(`Aiper mode selected: ${mode}`);

      if (mode === 'Smart' || mode === 'Floor' || mode === 'Wall') {
        await this.platform.aiperClient.startMode(mode);
      }
    } else {
      this.platform.log.info(`Aiper mode stopped: ${mode}`);
      await this.platform.aiperClient.stop();
    }
  }
}
