import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { AiperClient } from './aiperClient.js';
import { ExamplePlatformAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

interface AiperDevice {
  uniqueId: string;
  displayName: string;
  mode:
    | 'Main'
    | 'Battery'
    | 'CycleComplete'
    | 'MayBeStuck';
  serialNumber: string;
}

export class ExampleHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly aiperClient: AiperClient;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  private readonly discoveredCacheUUIDs: string[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.aiperClient = new AiperClient(
      {
        email: this.config.email as string | undefined,
        password: this.config.password as string | undefined,
        deviceId: this.config.deviceId as string | undefined,
      },
      this.log,
    );

    this.log.info('Finished initializing Aiper platform:', this.config.name ?? 'Aiper');

    this.api.on('didFinishLaunching', () => {
      this.log.info('Aiper plugin starting...');

      this.aiperClient.login()
        .then(async () => {
          this.log.info('Aiper login completed. Checking device list...');
          await this.aiperClient.getDevices();
          await this.aiperClient.getOpenIdToken();
          await this.aiperClient.getAwsCredentials();
          await this.aiperClient.connectMqtt();
          await this.aiperClient.subscribeToRobot();

          this.log.info('Aiper device check complete. Loading HomeKit accessories...');
          this.discoverDevices();
        })
        .catch((error: unknown) => {
          this.log.error('Aiper startup failed:', error);
          this.log.warn('Loading HomeKit accessories anyway.');
          this.discoverDevices();
        });
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  discoverDevices(): void {
    this.discoveredCacheUUIDs.length = 0;

    const aiperDevices: AiperDevice[] = [
      {
        uniqueId: 'aiper-scuba-n1-max-controls',
        displayName: 'Scuba N1 Max Controls',
        mode: 'Main',
        serialNumber: this.config.deviceId ?? 'Unknown',
      },
      {
        uniqueId: 'aiper-scuba-n1-max-battery',
        displayName: 'Scuba N1 Max Battery',
        mode: 'Battery',
        serialNumber: this.config.deviceId ?? 'Unknown',
      },
      {
        uniqueId: 'aiper-scuba-n1-max-cycle-complete',
        displayName: 'Aiper Has Finished the Job',
        mode: 'CycleComplete',
        serialNumber: this.config.deviceId ?? 'Unknown',
      },
      {
        uniqueId: 'aiper-scuba-n1-max-may-be-stuck',
        displayName: 'Aiper May Be Stuck',
        mode: 'MayBeStuck',
        serialNumber: this.config.deviceId ?? 'Unknown',
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
        this.log.info('Removing stale accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}