/* exported H10Connection */
class H10Connection {
  constructor(options={}) {
    this.env=options;this.device=null;this.characteristic=null;this.reading=null;this.state='idle';this.error='';this.generation=0;this.retryTimer=null;this.attempts=0;this.manual=false;this.onPacket=null;this.onDisconnect=null;
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
  async connect(automatic=false) {
    if(this.busy)return;
    if(!this.supported){this.state='unavailable';this.error=this.env.protocol==='file:'?'Open the HTTPS version in Android Chrome to connect H10. Manual HR still works.':!this.env.secure?'H10 needs an HTTPS page in Android Chrome.':'Bluetooth is unavailable in this browser. Use Android Chrome or manual HR.';this.emit();return;}
    this.clearRetry();if(!automatic)this.attempts=0;this.manual=false;
    const token=++this.generation;this.detach();this.clearReading();this.state=automatic?'reconnecting':'connecting';this.error='';this.emit();let choosing=false;
    try {
      if(!this.device){choosing=true;const device=await this.env.bluetooth.requestDevice({filters:[{namePrefix:'Polar H10'}],optionalServices:['heart_rate']});if(token!==this.generation)return;this.device=device;choosing=false;}
      const device=this.device;
      this.onDisconnect=()=>{if(token!==this.generation)return;++this.generation;this.detach();this.clearReading();this.state='disconnected';this.error='H10 disconnected. Use Polar for HR while it reconnects.';this.emit();this.scheduleRetry();};
      device.addEventListener('gattserverdisconnected',this.onDisconnect);
      // Each attempt obtains new services/characteristics after reconnecting.
      const server=await this.timed(device.gatt.connect().then(server=>{if(token!==this.generation && !this.busy && this.state!=='connected')device.gatt.disconnect();return server;}));if(token!==this.generation)return;
      const service=await this.timed(server.getPrimaryService('heart_rate'));if(token!==this.generation)return;
      const characteristic=await this.timed(service.getCharacteristic('heart_rate_measurement'));if(token!==this.generation)return;
      this.characteristic=characteristic;
      this.onPacket=event=>{
        if(token!==this.generation || !device.gatt.connected)return;
        const parsed=HeartRateCore.parse(event.target.value);
        this.reading=parsed?{...parsed,at:this.now()}:null;
        this.error=parsed?(parsed.valid?'':parsed.contact===false?'Check strap contact.':'Waiting for a valid HR reading.'):'Unreadable sensor packet. Waiting for a fresh reading.';
        this.env.onMeasurement?.(this.reading);this.emit();
      };
      characteristic.addEventListener('characteristicvaluechanged',this.onPacket);
      await this.timed(characteristic.startNotifications());if(token!==this.generation)return;
      this.state='connected';this.attempts=0;this.emit();
    } catch(error) {
      if(token!==this.generation)return;
      ++this.generation;this.detach();this.clearReading();this.device?.gatt.disconnect();this.state=this.device?'disconnected':'idle';
      this.error=choosing&&error.name==='NotFoundError'?'Connection cancelled. Manual HR is ready.':error.name==='NotAllowedError'?'Bluetooth permission was denied. Allow it in Chrome, or use manual HR.':error.name==='TimeoutError'?'H10 connection timed out. Check the strap and Bluetooth.':'Could not connect to H10. Wear the strap, check Bluetooth and enable two BLE receivers if Polar is connected.';
      this.emit();if(this.device&&error.name!=='NotAllowedError')this.scheduleRetry();
    }
  }
  disconnect() {this.manual=true;++this.generation;this.clearRetry();this.detach();this.clearReading();this.device?.gatt.disconnect();this.state='idle';this.error='Disconnected by you. Manual HR is ready.';this.emit();}
  visibilityChanged() {
    this.clearReading();
    if(!this.env.visible())this.clearRetry();
    // Returning to the page starts a fresh round, so 3 failed attempts earlier
    // do not leave the strap disconnected for the rest of the ride.
    else if(this.state==='disconnected'&&!this.manual){if(this.retryTimer===null)this.attempts=0;this.scheduleRetry();}
    this.emit();
  }
}
