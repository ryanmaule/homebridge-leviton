class LevitonAccessory {
  constructor(device, token, log, api) {
    this.api = api;
    this.log = log;
    this.device = device;
    this.token = token;
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.UUID = this.api.hap.uuid;
    const uuid = this.UUID.generate(device.serial);
    this.accessory = new this.api.platformAccessory(device.name, uuid);

    this.accessory.context.device = device;
    this.accessory.context.token = token;

    this.accessory
      .getService(this.Service.AccessoryInformation)
      .setCharacteristic(this.Characteristic.Name, device.name)
      .setCharacteristic(this.Characteristic.SerialNumber, device.serial)
      .setCharacteristic(this.Characteristic.Manufacturer, device.manufacturer)
      .setCharacteristic(this.Characteristic.Model, device.model)
      .setCharacteristic(this.Characteristic.FirmwareRevision, device.version);

    this.setupService();
  }

  async updateValues(power, brightness) {
    this.log.debug(`Updating values for ${this.device.name}: Power - ${power}, Brightness - ${brightness}`);
    const service =
      this.accessory.getService(this.Service.Fan) ||
      this.accessory.getService(this.Service.Switch) ||
      this.accessory.getService(this.Service.Outlet) ||
      this.accessory.getService(this.Service.Lightbulb);

    if (brightness !== undefined) {
      if(service.getCharacteristic(this.Characteristic.RotationSpeed)){
        service.getCharacteristic(this.Characteristic.RotationSpeed).updateValue(brightness);
      } else {
      service.getCharacteristic(this.Characteristic.Brightness).updateValue(brightness);
      }
    }
    service.getCharacteristic(this.Characteristic.On).updateValue(power === 'ON');
  }

  async setupService() {
    this.log.debug(`setupService: ${this.accessory.displayName}`);
    this.log.debug(`Device Model: ${this.device.model}`);

    switch (this.device.model) {
      case 'DW4SF': // Fan Speed Control
        this.setupFanService();
        break;
      case 'DWVAA': // Voice Dimmer with Amazon Alexa
      case 'DW1KD': // 1000W Dimmer
      case 'DW6HD': // 600W Dimmer
      case 'D26HD': // 600W Dimmer (2nd Gen)
      case 'D23LP': // Plug-In Dimmer (2nd Gen)
      case 'DW3HL': // Plug-In Dimmer
        this.setupLightbulbService();
        break;
      case 'DW15R': // Tamper Resistant Outlet
      case 'DW15A': // Plug-in Outlet (1/2 HP)
      case 'DW15P': // Plug-in Outlet (3/4 HP)
        this.setupOutletService();
        break;
      default:
        // Set up anything else as a simple switch (i.e. - DW15S, etc)
        this.setupSwitchService();
        break;
    }
  }

  async setupSwitchService() {
    this.log.debug(`Setting up device as Switch: ${this.accessory.displayName}`);
    const status = await this.getStatus();
    const service =
      this.accessory.getService(this.Service.Switch) || this.accessory.addService(this.Service.Switch, this.device.name);
    service
      .getCharacteristic(this.Characteristic.On)
      .onGet(this.onGetPower.bind(this))
      .onSet(this.onSetPower.bind(this))
      .updateValue(status.power === 'ON' ? true : false);
  }

  async setupOutletService() {
    this.log.debug(`Setting up device as Outlet: ${this.accessory.displayName}`);
    const status = await this.getStatus();
    const service =
      this.accessory.getService(this.Service.Outlet) || this.accessory.addService(this.Service.Outlet, this.device.name);
    service
      .getCharacteristic(this.Characteristic.On)
      .onGet(this.onGetPower.bind(this))
      .onSet(this.onSetPower.bind(this))
      .updateValue(status.power === 'ON' ? true : false);
  }

  async setupLightbulbService() {
    this.log.debug(`Setting up device as Lightbulb: ${this.accessory.displayName}`);
    const status = await this.getStatus();
    const service =
      this.accessory.getService(this.Service.Lightbulb) ||
      this.accessory.addService(this.Service.Lightbulb, this.device.name);
    service
      .getCharacteristic(this.Characteristic.On)
      .onGet(this.onGetPower.bind(this))
      .onSet(this.onSetPower.bind(this))
      .updateValue(status.power === 'ON' ? true : false);
    service
      .getCharacteristic(this.Characteristic.Brightness)
      .onGet(this.onGetBrightness.bind(this))
      .onSet(this.onSetBrightness.bind(this))
      .setProps({
        minValue: status.minLevel,
        maxValue: status.maxLevel,
        minStep: 1,
      })
      .updateValue(status.brightness);
  }

  async setupFanService() {
    this.log.debug(`Setting up device as Fan: ${this.accessory.displayName}`);
    const status = await this.getStatus();
    const service =
      this.accessory.getService(this.Service.Fan) || this.accessory.addService(this.Service.Fan, this.device.name);
    service
      .getCharacteristic(this.Characteristic.On)
      .onGet(this.onGetPower.bind(this))
      .onSet(this.onSetPower.bind(this))
      .updateValue(status.power === 'ON' ? true : false);
    service
      .getCharacteristic(this.Characteristic.RotationSpeed)
      .onGet(this.onGetRotationSpeed.bind(this))
      .onSet(this.onSetRotationSpeed.bind(this))
      .setProps({
        minValue: 0,
        maxValue: status.maxLevel,
        minStep: status.minLevel,
      })
      .updateValue(status.brightness);
  }

  async onGetPower() {
    const Leviton = require('./api.js');
    const res = await Leviton.getIotSwitch({
      switchID: this.device.id,
      token: this.token,
    });
    this.log.debug(`onGetPower: ${this.device.name} ${res.power}`);
    return res.power === 'ON';
  }

  async onSetPower(value) {
    const Leviton = require('./api.js');
    const res = await Leviton.putIotSwitch({
      switchID: this.device.id,
      power: value ? 'ON' : 'OFF',
      token: this.token,
    });
    this.log.info(`onSetPower: ${this.device.name} ${res.power}`);
  }

  async onGetBrightness() {
    const Leviton = require('./api.js');
    const res = await Leviton.getIotSwitch({
      switchID: this.device.id,
      token: this.token,
    });
    this.log.debug(`onGetBrightness: ${this.device.name} @ ${res.brightness}%`);
    return res.brightness;
  }

  async onSetBrightness(brightness) {
    const Leviton = require('./api.js');
    const res = await Leviton.putIotSwitch({
      switchID: this.device.id,
      brightness,
      token: this.token,
    });
    this.log.info(`onSetBrightness: ${this.device.name} @ ${res.brightness}%`);
  }

  async onGetRotationSpeed() {
    const Leviton = require('./api.js');
    const res = await Leviton.getIotSwitch({
      switchID: this.device.id,
      token: this.token,
    });
    this.log.debug(`onGetRotationSpeed: ${this.device.name} @ ${res.brightness}%`);
    return res.brightness;
  }

  async onSetRotationSpeed(brightness) {
    const Leviton = require('./api.js');
    const res = await Leviton.putIotSwitch({
      switchID: this.device.id,
      brightness,
      token: this.token,
    });
    this.log.info(`onSetRotationSpeed: ${this.device.name} @ ${res.brightness}%`);
  }

  async getStatus() {
    const Leviton = require('./api.js');
    this.log.debug(`getStatus: ${this.device.name}`);
    return Leviton.getIotSwitch({
      switchID: this.device.id,
      token: this.token,
    });
  }
}

module.exports = LevitonAccessory;