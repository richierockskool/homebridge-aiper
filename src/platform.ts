import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { AiperClient } from './aiperClient.js';
import { ExamplePlatformAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

export class ExampleHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly aiperClient: AiperClient;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.aiperClient = new AiperClient(
      {
        email: this.config.email as string | undefined,
        password: this.config.password as string | undefined,
        deviceId: this.config.deviceId as string | undefined,
      },
      this.log,
    );

    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', async () => {
      this.log.debug('Executed didFinishLaunching callback');

      await this.aiperClient.login();

      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  discoverDevices() {
    this.discoveredCacheUUIDs.length = 0;

    const aiperDevices = [
      {
        uniqueId: 'aiper-scuba-n1-max-smart',
        displayName: 'Scuba N1 Max Smart',
        mode: 'Smart',
        serialNumber: 'AIPER-SCUBA-N1-MAX-001-SMART',
      },
      {
        uniqueId: 'aiper-scuba-n1-max-floor',
        displayName: 'Scuba N1 Max Floor',
        mode: 'Floor',
        serialNumber: 'AIPER-SCUBA-N1-MAX-001-FLOOR',
      },
      {
        uniqueId: 'aiper-scuba-n1-max-wall',
        displayName: 'Scuba N1 Max Wall',
        mode: 'Wall',
        serialNumber: 'AIPER-SCUBA-N1-MAX-001-WALL',
      },
    ];

    for (const device of aiperDevices) {
      const uuid = this.api.hap.uuid.generate(device.uniqueId);
      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        existingAccessory.context.device = device;
        this.api.updatePlatformAccessories([existingAccessory]);

        new ExamplePlatformAccessory(this, existingAccessory);
      } else {
        this.log.info('Adding new accessory:', device.displayName);

        const accessory = new this.api.platformAccessory(device.displayName, uuid);
        accessory.context.device = device;

        new ExamplePlatformAccessory(this, accessory);

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      this.discoveredCacheUUIDs.push(uuid);
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}