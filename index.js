const Leviton = require('./api.js')
const LevitonAccessory = require('./levitonAccessory.js')
const levels = ['debug', 'info', 'warn', 'error']
const PLUGIN_NAME = 'homebridge-leviton';

class LevitonDecoraSmartPlatform {
  constructor(log, config, api) {
    this.config = config
    this.api = api
    this.accessories = []

    const noop = function () {}
    const logger = (level) => (msg) =>
      levels.indexOf((config && levels.includes(config.loglevel) && config.loglevel) || 'info') <= levels.indexOf(level)
        ? log(msg)
        : noop()

    // create a level method for each on this.log
    this.log = levels.reduce((a, l) => {
      a[l] = logger(l)
      return a
    }, {})

    if (config === null) {
      this.log.error(`No config for ${PLUGIN_NAME} defined.`)
      return
    }

    if (!config.email || !config.password) {
      this.log.error(`email and password for ${PLUGIN_NAME} are required in config.json`)
      return
    }

    // Initialize the platform and discover devices
    this.initialize().then(({ devices, token }) => {
      const excludedModels = (config.excludeModels || []).map(name => name.toUpperCase());
      const excludedSerials = (config.excludeSerials || []).map(name => name.toUpperCase());
      if (Array.isArray(devices) && devices.length > 0) {
        devices.forEach(device => {
          if (!this.accessories.find(acc => acc.uuid === this.api.hap.uuid.generate(device.serial))) {
            if (!excludedModels.includes(device.model) && !excludedSerials.includes(device.serial)) {
              this.addAccessory(device, token);
            }
            }
          });
        } else {
          this.log.error('Unable to initialize: no devices found');
        }
      })
  }

  subscriptionCallback(payload) {
    const accessory = this.accessories.find((acc) => acc.accessory.context.device.id === payload.id)
    const { power, brightness } = payload

    if (!accessory) return

    accessory.updateValues(power, brightness)
  }

  // init function that sets up personID, accountID and residenceID to return token+devices
  async initialize() {
    this.log.debug('initialize')

    try {
      var login = await Leviton.postPersonLogin({
        email: this.config['email'],
        password: this.config['password'],
      })
      var { id: token, userId: personID } = login
      this.log.debug(`personID: ${personID}, hasToken: ${!!token}`)
    } catch (err) {
      this.log.error(`Failed to login to leviton: ${err.message}`)
    }
    try {
      const permissions = await Leviton.getPersonResidentialPermissions({
        personID,
        token,
      })
      var accountID = permissions[0].residentialAccountId
      this.log.debug(`accountID: ${accountID}`)
    } catch (err) {
      this.log.error(`Failed to get leviton accountID: ${err.message}`)
    }
    try {
      var { primaryResidenceId: residenceID, id: residenceObjectID } = await Leviton.getResidentialAccounts({
        accountID,
        token,
      })
      this.log.debug(`residenceID: ${residenceID}`)
    } catch (err) {
      this.log.error(`Failed to get leviton residenceID: ${err.message}`)
    }
    try {
      var devices = await Leviton.getResidenceIotSwitches({
        residenceID,
        token,
      })
      this.log.debug(`devices: ${JSON.stringify(devices)}`)
    } catch (err) {
      this.log.error(`Failed to get leviton devices: ${err.message}`)
    }

    try {
      if (!Array.isArray(devices) || devices.length < 1) {
        this.log.info('No devices found for primary residence id. Trying residence v2')

        const accountsV2Response = await Leviton.getResidentialAccountsV2({
          residenceObjectID,
          token,
        })

        if (accountsV2Response[0]) {
          residenceID = accountsV2Response[0].id
          devices = await Leviton.getResidenceIotSwitches({
            residenceID,
            token,
          })
        } else {
          throw new Error('No residenceIDs found')
        }

        if (!Array.isArray(devices) || devices.length < 1) {
          throw new Error(
            `No devices found for residenceID: ${residenceID} or residenceIDV2 method: ${residenceObjectID}`
          )
        } else {
          Leviton.subscribe(login, devices, this.subscriptionCallback.bind(this), this)
        }
      } else {
        Leviton.subscribe(login, devices, this.subscriptionCallback.bind(this), this)
      }
    } catch (err) {
      this.log.error(`Error subscribing devices to websocket updates: ${err.message}`)
    }

    return { devices, token }
  }

  // switch power state getter, closure with service, device and token
  async onGetPower(service, device, token) {
    try {
      const res = await Leviton.getIotSwitch({ switchID: device.id, token })
      this.log.debug(`onGetPower: ${device.name} ${res.power}`)
      service.getCharacteristic(Characteristic.On).updateValue(res.power === 'ON')
      return res.power === 'ON'
    } catch (err) {
      this.log.error(`onGetPower error: ${err.message}`)
      throw err
    }
  }

  // switch power state setter, closure with service, device and token
  async onSetPower(service, device, token, value) {
    try {
      const res = await Leviton.putIotSwitch({ switchID: device.id, power: value ? 'ON' : 'OFF', token })
      this.log.info(`onSetPower: ${device.name} ${res.power}`)
      service.getCharacteristic(Characteristic.On).updateValue(res.power === 'ON')
    } catch (err) {
      this.log.error(`onSetPower error: ${err.message}`)
      throw err
    }
  }

  // switch brightness getter closure with service, device and token
  async onGetBrightness(service, device, token) {
    try {
      const res = await Leviton.getIotSwitch({ switchID: device.id, token })
      this.log.debug(`onGetBrightness: ${device.name} @ ${res.brightness}%`)
      service.getCharacteristic(Characteristic.Brightness).updateValue(res.brightness)
      return res.brightness
    } catch (err) {
      this.log.error(`onGetBrightness error: ${err.message}`)
      throw err
    }
  }

  // switch brightness setter closure with service, device and token
  async onSetBrightness(service, device, token, brightness) {
    try {
      const res = await Leviton.putIotSwitch({ switchID: device.id, brightness, token })
      this.log.info(`onSetBrightness: ${device.name} @ ${res.brightness}%`)
      service.getCharacteristic(Characteristic.Brightness).updateValue(res.brightness)
    } catch (err) {
      this.log.error(`onSetBrightness error: ${err.message}`)
      throw err
    }
  }

  // switch RotationSpeed getter closure with service, device and token
  async onGetRotationSpeed(service, device, token) {
    try {
      return Leviton.getIotSwitch({
        switchID: device.id,
        token,
      })
        .then((res) => {
          this.log.debug(`onGetRotationSpeed: ${device.name} @ ${res.brightness}%`)
          service.getCharacteristic(Characteristic.RotationSpeed).updateValue(res.brightness)
          return res.brightness
        })
    } catch (err) {
      this.log.error(`onGetRotationSpeed error: ${err.message}`)
      throw err
    }
  }

  // switch RotationSpeed setter closure with service, device and token
  async onSetRotationSpeed(service, device, token, brightness) {
    try {
      return Leviton.putIotSwitch({
        switchID: device.id,
        brightness,
        token,
      })
        .then((res) => {
          this.log.info(`onSetRotationSpeed: ${device.name} @ ${res.brightness}%`) // Assuming res contains updated brightness
          service.getCharacteristic(Characteristic.RotationSpeed).updateValue(res.brightness) // Update characteristic with the response value
        })
    } catch (err) {
      this.log.error(`onSetRotationSpeed error: ${err.message}`)
    }
  }

  async addAccessory(device, token) {
    this.log.info(`addAccessory ${device.name}`)

    // save device and token information to context for later use
    const accessory = new LevitonAccessory(device, token, this.log, this.api)

    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory.accessory]);

    // Moved to LevitonAccessory class
    // save device info to AccessoryInformation service (which always exists?)
    accessory
      .getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Name, device.name)
      .setCharacteristic(Characteristic.SerialNumber, device.serial)
      .setCharacteristic(Characteristic.Manufacturer, device.manufacturer)
      .setCharacteristic(Characteristic.Model, device.model)
      .setCharacteristic(Characteristic.FirmwareRevision, device.version)
    // setupService adds services, characteristics and getters/setters
    this.setupService(accessory)
    // add configured accessory
    this.accessories.push(accessory)
    this.log.debug(`Finished adding accessory ${device.name}`)
  }
  // set up cached accessories
  async configureAccessory(accessory) {
    const device = accessory.context.device
    const token = accessory.context.token
    const status = await this.getStatus(device, token)
    this.log.debug(`configureAccessory: ${accessory.displayName}`)
    this.setupService(accessory)
    this.accessories.push(accessory)
  }

  // fetch the status of a device to populate power state and brightness
  async getStatus(device, token) {
    this.log.debug(`getStatus: ${device.name}`)
    return Leviton.getIotSwitch({
      switchID: device.id,
      token,
    })
  }

  // setup service function
  async setupService(accessory) {
    this.log.debug(`setupService: ${accessory.displayName}`)

    // get device and token out of context to update status
    const device = accessory.context.device
    const token = accessory.context.token

    // Get the model number
    this.log.debug(`Device Model: ${device.model}`)

    switch (device.model) {
      case 'DW4SF': // Fan Speed Control
        this.setupFanService(accessory)
        break
      case 'DWVAA': // Voice Dimmer with Amazon Alexa
      case 'DW1KD': // 1000W Dimmer
      case 'DW6HD': // 600W Dimmer
      case 'D26HD': // 600W Dimmer (2nd Gen)
      case 'D23LP': // Plug-In Dimmer (2nd Gen)
      case 'DW3HL': // Plug-In Dimmer
        this.setupLightbulbService(accessory)
        break
      case 'DW15R': // Tamper Resistant Outlet
      case 'DW15A': // Plug-in Outlet (1/2 HP)
      case 'DW15P': // Plug-in Outlet (3/4 HP)
        this.setupOutletService(accessory)
        break
      default:
        // Set up anything else as a simple switch (i.e. - DW15S, etc)
        this.setupSwitchService(accessory)
        break
    }
  }

  async setupSwitchService(accessory) {
    this.log.debug(`Setting up device as Switch: ${accessory.displayName}`)

    // get device and token out of context to update status
    const device = accessory.context.device
    const token = accessory.context.token
    const status = await this.getStatus(device, token)

    // get the accessory service, if not add it
    const service = accessory.getService(this.api.hap.Service.Switch, device.name) || accessory.addService(this.api.hap.Service.Switch, device.name)

    // add handlers for on/off characteristic, set initial value
    service
      .getCharacteristic(this.api.hap.Characteristic.On)
      .on('get', this.onGetPower(service, device, token).bind(this))
      .on('set', (value, callback) => this.onSetPower(service, device, token, value).then(() => callback(), callback))
      .on('set', this.onSetPower(service, device, token).bind(this))
      .updateValue(status.power === 'ON' ? true : false)
  }

  async setupOutletService(accessory) {
    this.log.debug(`Setting up device as Outlet: ${accessory.displayName}`)

    // get device and token out of context to update status
    const device = accessory.context.device
    const token = accessory.context.token
    const status = await this.getStatus(device, token)

    // get the accessory service, if not add it
    const service = accessory.getService(this.api.hap.Service.Outlet, device.name) || accessory.addService(this.api.hap.Service.Outlet, device.name)

    // add handlers for on/off characteristic, set initial value
    service
      .getCharacteristic(this.api.hap.Characteristic.On)
      .on('get', this.onGetPower(service, device, token).bind(this))
      .on('set', (value, callback) => this.onSetPower(service, device, token, value).then(() => callback(), callback))
      .on('set', this.onSetPower(service, device, token).bind(this))
      .updateValue(status.power === 'ON' ? true : false)
  }

  async setupLightbulbService(accessory) {
    this.log.debug(`Setting up device as Lightbulb: ${accessory.displayName}`)

    // get device and token out of context to update status
    const device = accessory.context.device
    const token = accessory.context.token
    const status = await this.getStatus(device, token)

    // get the accessory service, if not add it
    const service = accessory.getService(this.api.hap.Service.Lightbulb, device.name) || accessory.addService(this.api.hap.Service.Lightbulb, device.name)

    // add handlers for on/off characteristic, set initial value
    service
      .getCharacteristic(this.api.hap.Characteristic.On)
      .on('get', this.onGetPower(service, device, token).bind(this))
      .on('set', (value, callback) => this.onSetPower(service, device, token, value).then(() => callback(), callback))
      .on('set', this.onSetPower(service, device, token).bind(this))
      .updateValue(status.power === 'ON' ? true : false)

    // set handlers for brightness, set initial value and min/max bounds
    service
      .getCharacteristic(Characteristic.Brightness)
      .on('get', this.onGetBrightness(service, device, token).bind(this))
      .on('set', (value, callback) => this.onSetBrightness(service, device, token, value).then(() => callback(), callback))
      .setProps({
        minValue: Math.max(0, status.minLevel), // ensure minLevel is not negative
        maxValue: status.maxLevel,
        minStep: 1,
      })
      .updateValue(status.brightness)
  }

  async setupFanService(accessory) {
    this.log.debug(`Setting up device as Fan: ${accessory.displayName}`)

    // get device and token out of context to update status
    const device = accessory.context.device
    const token = accessory.context.token
    const status = await this.getStatus(device, token)

    // get the accessory service, if not add it
    const service = accessory.getService(this.api.hap.Service.Fan, device.name) || accessory.addService(this.api.hap.Service.Fan, device.name)

    // add handlers for on/off characteristic, set initial value
    service
      .getCharacteristic(this.api.hap.Characteristic.On)
      .on('get', this.onGetPower(service, device, token).bind(this))
      .on('set', (value, callback) => this.onSetPower(service, device, token, value).then(() => callback(), callback))
      .updateValue(status.power === 'ON' ? true : false)

    // set handlers for brightness, set initial value and min/max bounds
    service
      .getCharacteristic(Characteristic.RotationSpeed)
      .on('get', this.onGetRotationSpeed(service, device, token).bind(this))
      .on('set', this.onSetRotationSpeed(service, device, token).bind(this))
      .setProps({ // RotationSpeed characteristic has different props
        minValue: 0,
        maxValue: status.maxLevel,
        minStep: status.minLevel,
      })
      .updateValue(status.brightness)
  }

  // remove accessories and unregister
  removeAccessories() {
    this.log.info('Removing all accessories')
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories)
    this.accessories.splice(0, this.accessories.length)
  }
}

module.exports = function (homebridge) {
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, LevitonDecoraSmartPlatform);
}
