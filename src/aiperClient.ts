import type { Logging } from 'homebridge';
import { AiperCrypto } from './aiperCrypto.js';
import { auth, io, iot, mqtt } from 'aws-iot-device-sdk-v2';

export type AiperMode = 'Smart' | 'Floor' | 'Wall' | 'Waterline';

export interface AiperClientConfig {
  email?: string;
  password?: string;
  deviceId?: string;
}
export interface AiperStateUpdate {
  status: number;
  mode: number;
  battery: number;
  warning: number;
  inWater: number;
  online: boolean;
  wifiConnected: boolean;
}
export class AiperClient {

  private readonly crypto = new AiperCrypto();

  private token?: string;
  private userId?: string;
  private baseUrl = 'https://apiamerica.aiper.com';
  private identityId?: string;
  private identityPoolId?: string;
  private openIdToken?: string;
  private iotEndpoint?: string;
  private awsRegion?: string;
  private awsAccessKeyId?: string;
  private awsSecretAccessKey?: string;
  private awsSessionToken?: string;
  private mqttConnection?: mqtt.MqttClientConnection;
  private mqttConnected = false;
  private lastCommandKey?: string;
  private lastCommandAt = 0;
  public latestBattery = 100;
  public latestStatus = 0;
  public latestMode = 0;
  public latestWarn = 0;
  public latestInWater = 0;
  public latestOnline = true;
  public latestWifiConnected = true;

  private hasObservedCleaningCycle = false;
  private disconnectedDuringCycle = false;
  private completionSentForCurrentCycle = false;

  private readonly cycleCompleteListeners = new Set<() => void>();
  private readonly stateUpdateListeners = new Set<(state: AiperStateUpdate) => void>();

  constructor(
    private readonly config: AiperClientConfig,
    private readonly log: Logging,
  ) {}
  async login(): Promise<void> {
    if (!this.config.email || !this.config.password) {
      this.log.warn('Aiper login skipped: email/password not configured.');
      return;
    }

    const loginBody = {
      email: this.config.email,
      password: this.config.password,
    };

    const headers = {
      'Content-Type': 'application/json',
      version: '3.0.0',
      os: 'android',
      charset: 'UTF-8',
      'Accept-Language': 'en',
      zoneId: 'America/Toronto',
      token: '',
      encryptKey: this.crypto.encryptKeyHeader,
    };

    const response = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers,
      body: this.crypto.encryptRequest(loginBody),
    });

    const text = await response.text();
    const decrypted = this.crypto.decryptResponse(text);
    const payload = JSON.parse(decrypted);

    if (!(payload.code === 0 || payload.code === '0' || payload.successful === true)) {
      throw new Error(`Aiper login failed: ${payload.msg ?? payload.message ?? 'Unknown error'}`);
    }

    const data = payload.data ?? {};

    this.token = data.token;
    this.userId = data.serialNumber;

    if (Array.isArray(data.domain) && data.domain.length > 0) {
      this.baseUrl = String(data.domain[0]).replace(/\/$/, '');
    }

    if (!this.token) {
      throw new Error('Aiper login failed: no token returned.');
    }

    this.log.info('Aiper login successful.');
  }
  async getDevices(): Promise<void> {
    if (!this.token) {
      this.log.warn('Aiper getDevices skipped: not logged in.');
      return;
    }
  
    const headers = {
      'Content-Type': 'application/json',
      version: '3.0.0',
      os: 'android',
      charset: 'UTF-8',
      'Accept-Language': 'en',
      zoneId: 'America/Toronto',
      token: this.token,
      encryptKey: this.crypto.encryptKeyHeader,
    };

    const response = await fetch(`${this.baseUrl}/equipment/getEquipment`, {
      method: 'POST',
      headers,
      body: this.crypto.encryptRequest({}),
    });

    const text = await response.text();
    const decrypted = this.crypto.decryptResponse(text);
    const payload = JSON.parse(decrypted);

    if (!(payload.code === 0 || payload.code === '0' || payload.successful === true)) {
      throw new Error(`Aiper getDevices failed: ${payload.msg ?? payload.message ?? 'Unknown error'}`);
    }

    const devices = Array.isArray(payload.data)
      ? payload.data
      : payload.data?.list ?? payload.data?.equipments ?? [];

    this.log.info(`Aiper devices found: ${devices.length}`);

    for (const device of devices) {
      this.log.info(
        `Aiper device: name=${device.name ?? 'Unknown'} sn=${device.sn ?? 'Unknown'} model=${device.model ?? 'Unknown'}`,
      );
    }
  }

  async getOpenIdToken(): Promise<void> {
    if (!this.token) {
      throw new Error('Aiper OpenID skipped: no token.');
    }

    const headers = {
      'Content-Type': 'application/json',
      version: '3.0.0',
      os: 'android',
      charset: 'UTF-8',
      'Accept-Language': 'en',
      zoneId: 'America/Toronto',
      token: this.token,
      encryptKey: this.crypto.encryptKeyHeader,
    };

    const response = await fetch(`${this.baseUrl}/users/getOpenIdToken`, {
      method: 'POST',
      headers,
      body: this.crypto.encryptRequest({}),
    });

    const text = await response.text();
    const decrypted = this.crypto.decryptResponse(text);
    const payload = JSON.parse(decrypted);

    if (!(payload.code === 0 || payload.code === '0' || payload.successful === true)) {
      throw new Error(`Aiper OpenID failed: ${payload.msg ?? payload.message ?? 'Unknown error'}`);
    }

    const data = payload.data ?? {};

    this.identityId = data.identityId;
    this.identityPoolId = data.identityPoolId;
    this.openIdToken = data.token;
    this.iotEndpoint = data.iotEndpoint;
    this.awsRegion = data.region;

    this.log.info(`Aiper OpenID OK. IoT endpoint: ${this.iotEndpoint ?? 'missing'}`);
  }

  async getAwsCredentials(): Promise<void> {
    if (!this.identityId || !this.openIdToken) {
      throw new Error('Aiper AWS credentials skipped: missing identityId/openIdToken.');
    }

    let region = this.awsRegion;

    if (!region && this.iotEndpoint?.includes('.iot.')) {
      region = this.iotEndpoint.split('.iot.')[1]?.split('.')[0];
    }

    region = region ?? 'us-east-2';

    const response = await fetch(`https://cognito-identity.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityService.GetCredentialsForIdentity',
      },
      body: JSON.stringify({
        IdentityId: this.identityId,
        Logins: {
          'cognito-identity.amazonaws.com': this.openIdToken,
        },
      }),
    });

    const text = await response.text();
    const payload = JSON.parse(text);

    const credentials = payload.Credentials ?? {};

    this.awsAccessKeyId = credentials.AccessKeyId;
    this.awsSecretAccessKey = credentials.SecretKey;
    this.awsSessionToken = credentials.SessionToken;

    if (!this.awsAccessKeyId || !this.awsSecretAccessKey) {
      throw new Error(`Aiper AWS credentials failed: ${text}`);
    }

    this.log.info('Aiper AWS credentials OK.');
  }
  async getStatus(): Promise<void> {
    this.log.info('Aiper status placeholder called.');

    // Later:
    // Return battery, charging, current mode, online/offline, etc.
  }
  async connectMqtt(): Promise<void> {
    if (!this.iotEndpoint || !this.awsRegion || !this.identityId) {
      throw new Error('Aiper MQTT skipped: missing IoT endpoint/region/identity.');
    }

    if (!this.awsAccessKeyId || !this.awsSecretAccessKey) {
      throw new Error('Aiper MQTT skipped: missing AWS credentials.');
    }

    const bootstrap = new io.ClientBootstrap();

    const credentialsProvider = auth.AwsCredentialsProvider.newStatic(
      this.awsAccessKeyId,
      this.awsSecretAccessKey,
      this.awsSessionToken,
    );

    const configBuilder = iot.AwsIotMqttConnectionConfigBuilder.new_with_websockets({
      region: this.awsRegion,
      credentials_provider: credentialsProvider,
    });

    configBuilder.with_endpoint(this.iotEndpoint);
    configBuilder.with_client_id(this.identityId);
    configBuilder.with_clean_session(false);
    configBuilder.with_keep_alive_seconds(60);

    const client = new mqtt.MqttClient(bootstrap);
    this.mqttConnection = client.new_connection(configBuilder.build());

    await this.mqttConnection.connect();

    this.mqttConnected = true;
    this.log.info('Aiper MQTT connected.');
  }

  private crc16(data: string): number {
    let crc = 0x9966;

    for (const char of Buffer.from(data, 'utf8')) {
      crc ^= char;

      for (let i = 0; i < 8; i++) {
        if (crc & 1) {
          crc = (crc >> 1) ^ 0xA001;
        } else {
          crc >>= 1;
        }
      }
    }

    return crc;
  }

  private modeNumber(mode: AiperMode): number {
    switch (mode) {
    case 'Smart':
      return 1;
    case 'Floor':
      return 2;
    case 'Wall':
      return 3;
    case 'Waterline':
      return 4; 
    }
  }

  async subscribeToRobot(): Promise<void> {
    if (!this.mqttConnection) {
      this.log.warn('Aiper MQTT subscribe skipped: no connection.');
      return;
    }

    const sn = this.config.deviceId;

    if (!sn) {
      throw new Error('Aiper deviceId not configured.');
    }

    const topics = [
      `aiper/things/${sn}/upChan`,
      `aiper/things/${sn}/shadow/report`,
      `$aws/things/${sn}/shadow/get/accepted`,
      `$aws/things/${sn}/shadow/update/accepted`,
      `$aws/things/${sn}/shadow/update/delta`,
    ];

    for (const topic of topics) {
      await this.mqttConnection.subscribe(topic, mqtt.QoS.AtLeastOnce, (receivedTopic, payload) => {
        const message = new TextDecoder().decode(payload);
        this.handleIncomingMqtt(receivedTopic, message);
      });

      this.log.info(`Aiper subscribed to ${topic}`);
    }
  }
  public onCycleComplete(listener: () => void): () => void {
    this.cycleCompleteListeners.add(listener);

    return () => {
      this.cycleCompleteListeners.delete(listener);
    };
  }

  public onStateUpdate(listener: (state: AiperStateUpdate) => void): () => void {
    this.stateUpdateListeners.add(listener);

    return () => {
      this.stateUpdateListeners.delete(listener);
    };
  }

  private emitStateUpdate(): void {
    const state: AiperStateUpdate = {
      status: this.latestStatus,
      mode: this.latestMode,
      battery: this.latestBattery,
      warning: this.latestWarn,
      inWater: this.latestInWater,
      online: this.latestOnline,
      wifiConnected: this.latestWifiConnected,
    };

    for (const listener of this.stateUpdateListeners) {
      try {
        listener(state);
      } catch (error) {
        this.log.error(
          `Aiper state listener failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private emitCycleComplete(): void {
    this.log.info('Aiper cleaning cycle complete: sending HomeKit notification.');

    for (const listener of this.cycleCompleteListeners) {
      try {
        listener();
      } catch (error) {
        this.log.error(
          `Aiper cycle-complete listener failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private evaluateCycleState(): void {
    /*
     * We currently treat a non-zero status while the cleaner is in the
     * water as evidence that a real cleaning cycle has been active.
     *
     * Completion requires:
     * 1. A cleaning cycle was previously observed.
     * 2. The cleaner disconnected during that cycle.
     * 3. Wi-Fi has reconnected.
     * 4. The machine is stopped.
     * 5. The cleaner still reports that it is in the water/waterline.
     */

    const cleanerIsInWater = this.latestInWater !== 0;
    const cleanerIsRunning = this.latestStatus !== 0;
    const cleanerIsStopped = this.latestStatus === 0;
    const connected = this.latestOnline && this.latestWifiConnected;

    if (cleanerIsRunning && cleanerIsInWater) {
      if (!this.hasObservedCleaningCycle) {
        this.log.info('Aiper cleaning cycle detected.');
      }

      this.hasObservedCleaningCycle = true;
      this.completionSentForCurrentCycle = false;
    }

    if (this.hasObservedCleaningCycle && !connected) {
      if (!this.disconnectedDuringCycle) {
        this.log.info('Aiper disconnected during cleaning cycle.');
      }

      this.disconnectedDuringCycle = true;
    }

    const cycleFinished =
      this.hasObservedCleaningCycle &&
      this.disconnectedDuringCycle &&
      connected &&
      cleanerIsStopped &&
      cleanerIsInWater &&
      !this.completionSentForCurrentCycle;

    if (!cycleFinished) {
      return;
    }

    this.completionSentForCurrentCycle = true;
    this.hasObservedCleaningCycle = false;
    this.disconnectedDuringCycle = false;

    this.emitCycleComplete();
  }
  private handleIncomingMqtt(topic: string, message: string): void {
    try {
      const payload = JSON.parse(message);

      const machine = payload?.state?.reported?.Machine;

      if (machine) {
        if (machine.status !== undefined) {
          this.latestStatus = Number(machine.status);
        }

        if (machine.mode !== undefined) {
          this.latestMode = Number(machine.mode);
        }

        if (machine.cap !== undefined) {
          this.latestBattery = Number(machine.cap);
        }

        if (machine.warn !== undefined || machine.warn_code !== undefined) {
          this.latestWarn = Number(machine.warn ?? machine.warn_code ?? 0);
        }

        if (machine.in_water !== undefined) {
          this.latestInWater = Number(machine.in_water);
        }

        this.log.info(
          `Aiper status update: status=${this.latestStatus} ` +
          `mode=${this.latestMode} ` +
          `battery=${this.latestBattery}% ` +
          `warn=${this.latestWarn} ` +
          `inWater=${this.latestInWater}`,
        );

        this.emitStateUpdate();
        this.evaluateCycleState();
      }

      const netStat = payload?.state?.reported?.NetStat;

      if (netStat) {
        this.latestOnline = this.normaliseConnectionValue(netStat.online);
        this.latestWifiConnected = this.normaliseConnectionValue(netStat.sta);

        this.log.info(
          `Aiper network update: online=${netStat.online} ` +
          `ble=${netStat.ble} ` +
          `wifi=${netStat.sta}`,
        );

        this.emitStateUpdate();
        this.evaluateCycleState();
      }

      const data = payload?.data;

      if (payload?.type === 'DevInfoReport' && data) {
        this.log.info(
          `Aiper device info: model=${data.model} ip=${data.ip} ble=${data.bleName}`,
        );
      }
    } catch (error) {
      this.log.debug(
        `Ignored unrecognised MQTT message on ${topic}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private normaliseConnectionValue(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value !== 0;
    }

    if (typeof value === 'string') {
      const normalised = value.trim().toLowerCase();

      return ![
        '',
        '0',
        'false',
        'offline',
        'disconnected',
        'none',
      ].includes(normalised);
    }

    /*
     * Do not mark the robot offline merely because Aiper omitted a field
     * from one partial shadow update.
     */
    return true;
  }
  private async sendMachineAt(atCommand: string): Promise<void> {
    if (!this.mqttConnection || !this.mqttConnected) {
      await this.connectMqtt();
    }

    if (!this.mqttConnection) {
      throw new Error('Aiper MQTT connection unavailable.');
    }

    const sn = this.config.deviceId;

    if (!sn) {
      throw new Error('Aiper deviceId not configured.');
    }

    const data = {
      sn,
      timeZone: 'America/Toronto',
      cmd: atCommand,
    };

    const dataJson = JSON.stringify(data);

    const payload = {
      type: 'Machine',
      data,
      res: 0,
      chksum: this.crc16(dataJson),
    };

    const topic = `aiper/things/${sn}/downChan`;
    const message = JSON.stringify(payload);

    this.log.info(`Aiper MQTT publish ${topic}: ${message}`);

    await this.mqttConnection.publish(
      topic,
      message,
      mqtt.QoS.AtLeastOnce,
    );
  }
  async startMode(mode: AiperMode): Promise<void> {
    const modeId = this.modeNumber(mode);
    const key = `mode:${modeId}`;
    const now = Date.now();

    if (this.lastCommandKey === key && now - this.lastCommandAt < 2500) {
      this.log.warn(`Aiper duplicate command ignored: ${mode}`);
      return;
    }

    this.lastCommandKey = key;
    this.lastCommandAt = now;

    this.log.info(`Aiper real command: ${mode} -> AT+MODE=${modeId}`);
    await this.sendMachineAt(`AT+MODE=${modeId}`);
  }

  async stop(): Promise<void> {
    const key = 'mode:0';
    const now = Date.now();

    if (this.lastCommandKey === key && now - this.lastCommandAt < 2500) {
      this.log.warn('Aiper duplicate stop ignored.');
      return;
    }

    this.lastCommandKey = key;
    this.lastCommandAt = now;

    this.log.info('Aiper real command: stop -> AT+MODE=0');
    await this.sendMachineAt('AT+MODE=0');
  }
}