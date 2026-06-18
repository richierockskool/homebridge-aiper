import type { API } from 'homebridge';

import { AiperPlugin } from './plugin.js';


/**
 * This method registers the platform with Homebridge
 */
export default (api: API) => {
  api.registerAccessory('AIPER', AiperPlugin);
};
