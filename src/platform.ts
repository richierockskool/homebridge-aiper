import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { ExamplePlatformAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';



/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class ExampleHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    const email = this.config.email as string | undefined;
    const password = this.config.password as string | undefined;
    const deviceId = this.config.deviceId as string | undefined;

    if (!email || !password) {
      this.log.warn('Aiper email/password are not configured yet.');
    } else {
      this.log.info('Aiper account configured for:', email);
    }

    if (deviceId) {
      this.log.info('Aiper device ID configured:', deviceId);
    }
    

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
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
        SerialNumber: 'AIPER-SCUBA-N1-MAX-001-WALL',
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