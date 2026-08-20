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
  charging: boolean;
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
  public latestCharging = false;

  private hasObservedCleaningCycle = false;
  private disconnectedDuringCycle = false;
  private completionSentForCurrentCycle = false;
  private stuckNotificationSentForCurrentCycle = false;

  private cycleTimeout?: ReturnType<typeof setTimeout>;
  private cycleStartedAt = 0;
  private lastRecognisedStateAt = 0;
  private readonly cycleTimeoutMilliseconds =
    (160 * 60 * 1000);

  private readonly cycleCompleteListeners = new Set<() => void>();
  private readonly mayBeStuckListeners = new Set<() => void>();
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
  public onMayBeStuck(listener: () => void): () => void {
    this.mayBeStuckListeners.add(listener);

    return () => {
      this.mayBeStuckListeners.delete(listener);
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
      charging: this.latestCharging,
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
  private emitMayBeStuck(): void {
    this.log.warn(
      'Aiper has not returned to Wi-Fi after 160 minutes. Sending HomeKit warning.',
    );

    for (const listener of this.mayBeStuckListeners) {
      try {
        listener();
      } catch (error) {
        this.log.error(
          `Aiper may-be-stuck listener failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private beginCleaningCycle(source: string): void {
    if (this.hasObservedCleaningCycle) {
      return;
    }

    this.hasObservedCleaningCycle = true;

    /*
 * If the timer was started directly from a HomeKit cleaning command,
 * the robot may still be online for a short time before leaving Wi-Fi.
 *
 * Only mark the cycle as having actually disconnected when the
 * current connection state proves it.
 */
    this.disconnectedDuringCycle =
  !(this.latestOnline && this.latestWifiConnected);

    this.completionSentForCurrentCycle = false;
    this.stuckNotificationSentForCurrentCycle = false;

    this.log.info(
      `Aiper cleaning cycle confirmed (${source}). ` +
    'Starting 2 hour 40 minute safety timer.',
    );

    this.startCycleTimeout();
  }

  private startCycleTimeout(): void {
    this.cycleTimeout = setTimeout(() => {
      this.cycleTimeout = undefined;

      if (
        !this.hasObservedCleaningCycle ||
    this.completionSentForCurrentCycle ||
    this.stuckNotificationSentForCurrentCycle
      ) {
        return;
      }

     

      const connected =
    this.latestOnline &&
    this.latestWifiConnected;

      const stateIsRecent =
    this.lastRecognisedStateAt > 0 &&
    Date.now() - this.lastRecognisedStateAt <
      15 * 60 * 1000;

      /*
   * Do not issue a stuck warning when a recent report proves that the
   * cleaner is already online and out of the pool, such as when it has
   * been retrieved and returned to the charger.
   */
      
      if (
        stateIsRecent &&
  connected &&
  this.latestCharging
      ) {
        this.resetCleaningCycle(
          'timeout reached but robot is already charging',
        );

        return;
      }


      this.stuckNotificationSentForCurrentCycle = true;
      this.emitMayBeStuck();
    }, this.cycleTimeoutMilliseconds);
  }

  private clearCycleTimeout(): void {
    if (!this.cycleTimeout) {
      return;
    }

    clearTimeout(this.cycleTimeout);
    this.cycleTimeout = undefined;
  }

  private resetCleaningCycle(reason: string): void {
    this.clearCycleTimeout();

    this.hasObservedCleaningCycle = false;
    this.disconnectedDuringCycle = false;
    this.completionSentForCurrentCycle = false;
    this.stuckNotificationSentForCurrentCycle = false;
    this.cycleStartedAt = 0;

    this.log.info(`Aiper cleaning-cycle tracking reset: ${reason}.`);
  }

  private evaluateCycleState(): void {
    const cleanerIsInWater = this.latestInWater !== 0;

    const connected =
    this.latestOnline &&
    this.latestWifiConnected;

    const hasCleaningMode =
    this.latestMode >= 1 &&
    this.latestMode <= 4;

    /*
 * A robot that is charging cannot be in an active cleaning cycle.
 *
 * The N1 Max can retain its previous mode (for example Floor)
 * while sitting on the charger. When it later falls asleep,
 * online=false must NOT be mistaken for the start of a cleaning run.
 */
    if (this.latestCharging) {
      if (this.hasObservedCleaningCycle) {
        this.resetCleaningCycle(
          'robot is charging / on charger',
        );
      }

      return;
    } /*
   * Do NOT start cycle tracking merely because HomeKit sent a command.
   *
   * Start only when the Aiper itself has reported a valid cleaning
   * mode and then disappears from Wi-Fi.
   */
    if (
      !this.hasObservedCleaningCycle &&
    hasCleaningMode &&
    !connected
    ) {
      this.beginCleaningCycle(
        `robot went offline in mode ${this.latestMode}`,
      );

      return;
    }

    if (!this.hasObservedCleaningCycle) {
      return;
    }

    if (!connected) {
      this.disconnectedDuringCycle = true;
      return;
    }

    /*
   * A tracked robot has reconnected.
   *
   * If it reconnects while still in the water, that is the newer
   * waterline-return behavior requested by Joeyski.
   */
    if (
      this.disconnectedDuringCycle &&
  cleanerIsInWater &&
  !this.completionSentForCurrentCycle
    ) {
      this.completionSentForCurrentCycle = true;
      this.clearCycleTimeout();

      this.log.info(
        'Aiper returned to Wi-Fi at the waterline. Cycle completion confirmed.',
      );

      this.emitCycleComplete();

      this.hasObservedCleaningCycle = false;
      this.disconnectedDuringCycle = false;
      this.stuckNotificationSentForCurrentCycle = false;

      return;
    }

    /*
   * If it reconnects out of the water, it has been retrieved.
   * Cancel the timer immediately.
   *
   * This is your N1 Max case: somebody pulls it out, it reconnects,
   * then it eventually goes back to sleep on the charger.
   */
    /*
 * Do not cancel a newly started cycle merely because the robot is
 * still online and out of the water for a few seconds after the
 * cleaning command.
 *
 * Only treat it as genuinely retrieved once charging has started.
 */
    if (
      this.disconnectedDuringCycle &&
  !cleanerIsInWater &&
  this.latestCharging
    ) {
      this.resetCleaningCycle(
        'robot reconnected out of the water and is charging / retrieved',
      );
    }
  }
  private handleIncomingMqtt(
    topic: string,
    message: string,
  ): void {
    try {
      const payload: unknown = JSON.parse(message);

      this.log.debug(
        `Aiper MQTT received on ${topic}: ${message}`,
      );

      const handledUpChan =
      topic.includes('upChan') &&
      this.handleUpChanMessage(payload);

      const handledShadow =
      this.handleShadowMessage(payload);

      if (!handledUpChan && !handledShadow) {
        this.log.debug(
          `Aiper MQTT message contained no recognised state on ${topic}.`,
        );
      }
    } catch (error) {
      this.log.warn(
        `Aiper MQTT message parse failed on ${topic}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  private handleUpChanMessage(
    payload: unknown,
  ): boolean {
    if (
      typeof payload !== 'object' ||
    payload === null
    ) {
      return false;
    }

    const typedPayload = payload as {
    type?: unknown;
    data?: {
      status?: unknown;
      mode?: unknown;
      cap?: unknown;
      battery?: unknown;
      warn?: unknown;
      warn_code?: unknown;
      in_water?: unknown;
      inWater?: unknown;
      online?: unknown;
      sta?: unknown;
      wifiConnected?: unknown;
    };
  };

    if (
      typedPayload.type !== 'Machine' ||
    !typedPayload.data
    ) {
      return false;
    }

    const data = typedPayload.data;
    let recognised = false;

    const status =
  this.numberFromUnknown(data.status);

    const mode =
  this.numberFromUnknown(data.mode);

    const battery = this.numberFromUnknown(
      data.cap ?? data.battery,
    );

    const warning = this.numberFromUnknown(
      data.warn ?? data.warn_code,
    );

    const inWater = this.numberFromUnknown(
      data.in_water ?? data.inWater,
    );

    /*
 * IMPORTANT:
 * Determine charging BEFORE latestBattery is updated,
 * so a battery drop can be detected.
 */
    this.updateChargingState(
      status,
      battery,
      inWater,
    );

    if (status !== undefined) {
      this.latestStatus = status;
      recognised = true;
    }

    if (mode !== undefined) {
      this.latestMode = mode;
      recognised = true;
    }

    if (battery !== undefined) {
      this.latestBattery = battery;
      recognised = true;
    }

    if (warning !== undefined) {
      this.latestWarn = warning;
      recognised = true;
    }

    if (inWater !== undefined) {
      this.latestInWater = inWater;
      recognised = true;
    }

    if (data.online !== undefined) {
      this.latestOnline =
    this.normaliseConnectionValue(data.online);

      recognised = true;
    }

    const wifiValue =
  data.sta ??
  data.wifiConnected;

    if (wifiValue !== undefined) {
      this.latestWifiConnected =
    this.normaliseConnectionValue(wifiValue);

      recognised = true;
    }

    if (!recognised) {
      return false;
    }

    this.log.info(
      'Aiper upChan state: ' +
    `status=${this.latestStatus} ` +
    `mode=${this.latestMode} ` +
    `battery=${this.latestBattery}% ` +
    `warn=${this.latestWarn} ` +
    `inWater=${this.latestInWater} ` +
    `online=${this.latestOnline} ` +
    `wifi=${this.latestWifiConnected} ` +
    `charging=${this.latestCharging}`,

    );

    this.emitStateUpdate();
    this.evaluateCycleState();

    return true;
  }

  private handleShadowMessage(payload: unknown): boolean {
    if (
      typeof payload !== 'object' ||
    payload === null
    ) {
      return false;
    }

  type MachineState = {
    status?: unknown;
    mode?: unknown;
    cap?: unknown;
    battery?: unknown;
    warn?: unknown;
    warn_code?: unknown;
    in_water?: unknown;
    inWater?: unknown;
  };

  type NetworkState = {
    online?: unknown;
    sta?: unknown;
    wifiConnected?: unknown;
    ble?: unknown;
  };

  type ReportedState = {
    Machine?: MachineState;
    NetStat?: NetworkState;

    /*
     * Flat fields are retained as a fallback in case another Aiper
     * model or firmware reports a different shadow structure.
     */
    status?: unknown;
    mode?: unknown;
    cap?: unknown;
    battery?: unknown;
    warn?: unknown;
    warn_code?: unknown;
    in_water?: unknown;
    inWater?: unknown;
    online?: unknown;
    sta?: unknown;
    wifiConnected?: unknown;
  };

  const typedPayload = payload as {
    state?: {
      reported?: ReportedState;
      desired?: ReportedState;
      delta?: ReportedState;
      Machine?: MachineState;
      NetStat?: NetworkState;
    };
  };

  const reported: ReportedState | undefined =
    typedPayload.state?.reported ??
    typedPayload.state?.delta ??
    typedPayload.state;

  if (!reported) {
    return false;
  }

  const machine: MachineState =
    reported.Machine ?? reported;

  const network: NetworkState =
    reported.NetStat ?? reported;

  

  const status =
  this.numberFromUnknown(machine.status);

  const mode =
  this.numberFromUnknown(machine.mode);

  const battery = this.numberFromUnknown(
    machine.cap ?? machine.battery,
  );

  const warning = this.numberFromUnknown(
    machine.warn ?? machine.warn_code,
  );

  const inWater = this.numberFromUnknown(
    machine.in_water ?? machine.inWater,
  );

  /*
 * Determine charging BEFORE latestBattery is updated.
 */
  this.updateChargingState(
    status,
    battery,
    inWater,
  );

  if (
    status !== undefined &&
  status !== this.latestStatus
  ) {
    this.latestStatus = status;
  }

  if (
    mode !== undefined &&
  mode !== this.latestMode
  ) {
    this.latestMode = mode;
  }

  if (
    battery !== undefined &&
  battery !== this.latestBattery
  ) {
    this.latestBattery = battery;
  }

  if (
    warning !== undefined &&
  warning !== this.latestWarn
  ) {
    this.latestWarn = warning;
  }

  if (
    inWater !== undefined &&
  inWater !== this.latestInWater
  ) {
    this.latestInWater = inWater;
  }
  if (network.online !== undefined) {
    const online =
    this.normaliseConnectionValue(network.online);

    if (online !== this.latestOnline) {
      this.latestOnline = online;
    }
  }
  const wifiValue =
    network.sta ??
    network.wifiConnected;

  if (wifiValue !== undefined) {
    const wifiConnected =
      this.normaliseConnectionValue(wifiValue);

    if (
      wifiConnected !== this.latestWifiConnected
    ) {
      this.latestWifiConnected = wifiConnected;
     
    }
  }

  /*
   * Log every valid Machine or NetStat report, even where the value did
   * not change. This will reveal the real Aiper status sequence at the
   * end of a cleaning cycle.
   */
  if (reported.Machine || reported.NetStat) {
    this.log.info(
      `Aiper state: status=${this.latestStatus} ` +
      `mode=${this.latestMode} ` +
      `battery=${this.latestBattery}% ` +
      `warn=${this.latestWarn} ` +
      `inWater=${this.latestInWater} ` +
      `online=${this.latestOnline} ` +
      `wifi=${this.latestWifiConnected} ` +
      `charging=${this.latestCharging}`,
    );
  }

  const recognisedState =
  reported.Machine !== undefined ||
  reported.NetStat !== undefined ||
  status !== undefined ||
  mode !== undefined ||
  battery !== undefined ||
  warning !== undefined ||
  inWater !== undefined ||
  network.online !== undefined ||
  wifiValue !== undefined;

  if (!recognisedState) {
    return false;
  }

  /*
 * Always evaluate recognised reports. A completion message can repeat
 * existing values, so requiring stateChanged could suppress the event.
 */
  this.emitStateUpdate();
  this.evaluateCycleState();

  return true;
  }
  private updateChargingState(
    reportedStatus: number | undefined,
    reportedBattery: number | undefined,
    reportedInWater: number | undefined,
  ): void {
    const inWater =
    reportedInWater ?? this.latestInWater;

    /*
   * If the robot is in the pool, it cannot be charging.
   */
    if (inWater !== 0) {
      this.latestCharging = false;
      return;
    }

    /*
   * During confirmed charging the N1 Max repeatedly reports
   * status=2, interspersed with status=0 reports.
   *
   * status=2 therefore confirms charging, but status=0 does NOT
   * immediately cancel it.
   */
    if (reportedStatus === 2) {
      this.latestCharging = true;
      return;
    }

    /*
   * A falling battery level while out of the water is strong
   * confirmation that the cleaner has been removed from the charger.
   */
    if (
      reportedBattery !== undefined &&
    reportedBattery < this.latestBattery
    ) {
      this.latestCharging = false;
    }
  }

  private numberFromUnknown(
    value: unknown,
  ): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value)
        ? value
        : undefined;
    }

    if (
      typeof value === 'string' &&
    value.trim() !== ''
    ) {
      const parsed = Number(value);

      return Number.isFinite(parsed)
        ? parsed
        : undefined;
    }

    return undefined;
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

    this.log.info(
      `Aiper real command: ${mode} -> AT+MODE=${modeId}`,
    );

    this.latestCharging = false;

    await this.sendMachineAt(`AT+MODE=${modeId}`);

    /*
 * Arm the cleaning-cycle safety timer from the successful
 * cleaning command itself.
 *
 * Do not depend on the robot later reporting online=false,
 * because the N1 Max can disappear from MQTT during a run.
 */
    this.beginCleaningCycle(
      `HomeKit started ${mode} cleaning mode`,
    );

    
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

    this.resetCleaningCycle('manual stop command');
  }
}