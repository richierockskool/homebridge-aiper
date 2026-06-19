import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { ExampleHomebridgePlatform } from './platform.js';

export class ExamplePlatformAccessory {
  private switchService: Service;
  private isOn = false;
  private turnOffOtherModeSwitches(activeMode: 'Smart' | 'Floor' | 'Wall'| 'Waterline'): void {
    const deviceMode = this.accessory.context.device?.mode;

    for (const accessory of this.platform.accessories.values()) {
      const mode = accessory.context.device?.mode;

      if (mode && mode !== activeMode) {
        const service = accessory.getService(this.platform.Service.Switch);

        service?.updateCharacteristic(
          this.platform.Characteristic.On,
          false,
        );
      }
    }

    this.platform.log.info(`Aiper active mode set to: ${deviceMode}`);
  }
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
    const nextOn = value as boolean;

    if (this.isOn === nextOn) {
      return;
    }

    this.isOn = nextOn;

    const mode = this.accessory.context.device?.mode ?? 'Unknown';

    if (this.isOn) {
      this.turnOffOtherModeSwitches(mode);
      this.platform.log.info(`Aiper mode selected: ${mode}`);

      if (mode === 'Smart' || mode === 'Floor' || mode === 'Wall' || mode === 'Waterline') {
        await this.platform.aiperClient.startMode(mode);
      }
    } else {
      this.platform.log.info(`Aiper mode stopped: ${mode}`);
      await this.platform.aiperClient.stop();
    }
  }
}
