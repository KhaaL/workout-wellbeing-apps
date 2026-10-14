/* exported SensorConnection, H10Connection, BikeSensorConnection */
/* One Bluetooth sensor: choose a device, subscribe to its measurements, and
   reconnect after a drop. A profile says which services to offer in the
   browser's chooser, which characteristic to read, how to parse a packet and
   what to call the device in messages. */
class SensorConnection {
  constructor(options={},profile=SensorConnection.heartRate) {
    this.env=options;this.profile=profile;this.device=null;this.characteristic=null;this.reading=null;this.state='idle';this.error='';this.generation=0;this.retryTimer=null;this.attempts=0;this.manual=false;this.onPacket=null;this.onDisconnect=null;
  }
  get supported(){return Boolean(this.env.bluetooth && this.env.secure && this.env.protocol!=='file:');}
  get busy(){return ['connecting','reconnecting'].includes(this.state);}
  now(){return this.env.now();}
  emit(){this.env.onChange?.(this);}
  clearReading(){this.reading=null;this.env.onMeasurement?.(null);}
  clearRetry(){if(this.retryTimer!==null){this.env.clearTimeout(this.retryTimer);this.retryTimer=null;}}
  detach(){if(this.characteristic&&this.onPacket)this.characteristic.removeEventListener('characteristicvaluechanged',this.onPacket);if(this.device&&this.onDisconnect)this.device.removeEventListener('gattserverdisconnected',this.onDisconnect);this.characteristic=null;this.onPacket=null;this.onDisconnect=null;}
  async timed(promise) {
    let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=this.env.setTimeout(()=>{const error=new Error('Bluetooth connection timed out');error.name='TimeoutError';reject(error);},12000);})]);}
    finally{this.env.clearTimeout(timer);}
  }
  scheduleRetry() {
    if(this.manual || !this.device || this.retryTimer!==null || this.attempts>=3 || !this.env.visible())return;
    const delay=1000*2**this.attempts++;
    this.retryTimer=this.env.setTimeout(()=>{this.retryTimer=null;if(!this.manual && this.env.visible())this.connect(true);},delay);
    this.emit();
  }
  // The first service the device offers, in profile order, with its characteristic.
  async characteristicOf(server,token) {
    let lastError=null;
    for(const [service,name] of this.profile.characteristics){
      try{const found=await this.timed(server.getPrimaryService(service));if(token!==this.generation)return null;const characteristic=await this.timed(found.getCharacteristic(name));return {characteristic,parse:this.profile.parse[String(name)]};}
      catch(error){if(error.name==='TimeoutError')throw error;lastError=error;}
    }
    throw lastError||new Error('No supported service');
  }
  async connect(automatic=false) {
    const label=this.profile.label;
    if(this.busy)return;
    if(!this.supported){this.state='unavailable';this.error=this.env.protocol==='file:'?`Open the HTTPS version in Android Chrome to connect a ${label}. ${this.profile.manual}`:!this.env.secure?`A ${label} needs an HTTPS page in Android Chrome.`:`Bluetooth is unavailable in this browser. Use Android Chrome. ${this.profile.manual}`;this.emit();return;}
    this.clearRetry();if(!automatic)this.attempts=0;this.manual=false;
    const token=++this.generation;this.detach();this.clearReading();this.state=automatic?'reconnecting':'connecting';this.error='';this.emit();let choosing=false;
    try {
      if(!this.device){choosing=true;const device=await this.env.bluetooth.requestDevice({filters:this.profile.filters,optionalServices:this.profile.characteristics.map(([service])=>service)});if(token!==this.generation)return;this.device=device;choosing=false;}
      const device=this.device;
      this.onDisconnect=()=>{if(token!==this.generation)return;++this.generation;this.detach();this.clearReading();this.state='disconnected';this.error=`The ${label} disconnected. ${this.profile.dropped}`;this.emit();this.scheduleRetry();};
      device.addEventListener('gattserverdisconnected',this.onDisconnect);
      // Each attempt obtains new services/characteristics after reconnecting.
      const server=await this.timed(device.gatt.connect().then(server=>{if(token!==this.generation && !this.busy && this.state!=='connected')device.gatt.disconnect();return server;}));if(token!==this.generation)return;
      const found=await this.characteristicOf(server,token);if(!found||token!==this.generation)return;
      const {characteristic,parse}=found;this.characteristic=characteristic;let previous=null;
      this.onPacket=event=>{
        if(token!==this.generation || !device.gatt.connected)return;
        const parsed=parse(event.target.value,previous);if(parsed)previous=parsed;
        this.reading=parsed?{...parsed,at:this.now()}:null;
        this.error=parsed?this.profile.status(parsed):'Unreadable sensor packet. Waiting for a fresh reading.';
        this.env.onMeasurement?.(this.reading);this.emit();
      };
      characteristic.addEventListener('characteristicvaluechanged',this.onPacket);
      await this.timed(characteristic.startNotifications());if(token!==this.generation)return;
      this.state='connected';this.attempts=0;this.emit();
    } catch(error) {
      if(token!==this.generation)return;
      ++this.generation;this.detach();this.clearReading();this.device?.gatt.disconnect();this.state=this.device?'disconnected':'idle';
      this.error=choosing&&error.name==='NotFoundError'?`Connection cancelled. ${this.profile.manual}`:error.name==='NotAllowedError'?`Bluetooth permission was denied. Allow it in Chrome. ${this.profile.manual}`:error.name==='TimeoutError'?`The ${label} connection timed out. Check the device and Bluetooth.`:this.profile.failed;
      this.emit();if(this.device&&error.name!=='NotAllowedError')this.scheduleRetry();
    }
  }
  disconnect() {this.manual=true;++this.generation;this.clearRetry();this.detach();this.clearReading();this.device?.gatt.disconnect();this.state='idle';this.error=`Disconnected by you. ${this.profile.manual}`;this.emit();}
  visibilityChanged() {
    this.clearReading();
    if(!this.env.visible())this.clearRetry();
    // Returning to the page starts a fresh round, so 3 failed attempts earlier
    // do not leave the sensor disconnected for the rest of the ride.
    else if(this.state==='disconnected'&&!this.manual){if(this.retryTimer===null)this.attempts=0;this.scheduleRetry();}
    this.emit();
  }
}
// Any strap with the standard Heart Rate service.
SensorConnection.heartRate={
  label:'heart-rate strap',filters:[{services:['heart_rate']}],characteristics:[['heart_rate','heart_rate_measurement']],
  parse:{heart_rate_measurement:value=>HeartRateCore.parse(value)},
  status:parsed=>parsed.valid?'':parsed.contact===false?'Check strap contact.':'Waiting for a valid HR reading.',
  manual:'Manual HR is ready.',dropped:'Read HR from your watch or app while it reconnects.',
  failed:'Could not connect to the heart-rate strap. Wear it, check Bluetooth, and allow a second Bluetooth connection if another app also uses it.'
};
// A smart bike or trainer (Fitness Machine) or a power meter (Cycling Power).
SensorConnection.bikePower={
  label:'bike power sensor',filters:[{services:[0x1826]},{services:[0x1818]}],characteristics:[[0x1826,0x2AD2],[0x1818,0x2A63]],
  parse:{[0x2AD2]:value=>PowerCore.parseIndoorBike(value),[0x2A63]:(value,previous)=>PowerCore.parseCyclingPower(value,previous)},
  status:()=>'',manual:'Enter watts and cadence from the bike after the ride.',dropped:'Readings pause until it reconnects.',
  failed:'Could not connect to the bike. Wake its console, check Bluetooth, and close other apps connected to it.'
};
class H10Connection extends SensorConnection {constructor(options={}){super(options,SensorConnection.heartRate);}}
class BikeSensorConnection extends SensorConnection {constructor(options={}){super(options,SensorConnection.bikePower);}}
