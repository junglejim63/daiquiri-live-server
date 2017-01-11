//*******************************************************
// Monitors a Daktronics timer communication queue and emits current live state as well as faster updates when needed
//*******************************************************
//Load required modules
var amqp = require('amqplib/callback_api');
var util = require("util");
var events = require("events");

//*******************************************
// Daktronics Live object - reflects state of a Daktronics timer
//*******************************************
function DaiquiriLive(config) {
   var i;
   events.EventEmitter.call(this);
   this.config = config;
   this.live = {pool: config.pool,
               clk: {date: "01/01/2000", tod: "00:00:00", race: "0.0"},
               race: {e: "  1", h: " 1", name: "No Event", lengths: "", num: ""},
               lanes:[],
               inputs: {starter: false, lanes:[]}
               };
   for (i = 0; i < config.pool.lanes; i++) {
      this.live.lanes[i] = {name: "", team: "", place: "", lengths: "", time: "", 
                            btns:["", "", "", ""]};
      this.live.inputs.lanes[i] = {pad: false, btns: [false, false, false]};
   }
   this.update = {};
   this.evtLookup = {};
   this.amqpQueueOpts = {exclusive: true, durable: false, autoDelete: false, messageTtl: 10000, arguments: {}};
   this.amqpChannel = null;
   this.amqpQueue = null;
   this.lastMsg = null;
   this.amqpState = "unconnected";
   this.amqpURL = 'amqp://'+config.amqp.user+':'+config.amqp.pass+'@'+config.amqp.locator;
   this.amqpRetry = config.amqp.retryMin;
   startAMQP(this);
   var me = this;
   this.fullUpdate = setInterval(function() {
      me.emit("live", me.live);
   }, config.updatesMS.full);
   this.partialUpdate = setInterval(function() {
      if (Object.keys(me.update).length > 0) {
         me.emit("update", me.update);
         me.update = {};
      }
   }, config.updatesMS.partial);
}
util.inherits(DaiquiriLive, events.EventEmitter);
module.exports.DaiquiriLive = DaiquiriLive;

function updateImmediate(q,val) {
   q.emit("updateIO", val);
}

function retryAMQP(q) {
   q.amqpRetry = Math.min(q.amqpRetry + 2000, q.config.amqp.retryMax);
   q.amqpState = "closed";
   for (var lane = 0; lane < q.config.pool.lanes; lane++) {
      clearNames(q, lane);
      clearResults(q, lane);
   }
   setTimeout(function(){startAMQP(q);}, q.amqpRetry);
}

function startAMQP(q) {
   amqp.connect(q.amqpURL, function(err, conn) {
   if (err) {
      console.log(printdate()+" Error creating connection to AMQP queue: "+q.amqpURL+", "+err);
      retryAMQP(q);
   } else {
      conn.on('close', function() {
         console.log('Connection to '+q.amqpURL+' unexpectedly closed.  Last received: '+ q.lastMsg);
         retryAMQP(q);
      });
      conn.on('error', function() {
         console.log('Error on Connection to '+q.amqpURL+'.');
         retryAMQP(q);
      });
      conn.createChannel(function(err, ch) {
         if (err) {
            console.log(printdate()+" Error creating channel on AMQP queue: "+q.amqpURL+", "+err);
            conn.close();
            retryAMQP(q);
         } else {
            q.amqpChannel = ch;
            //channel is ready, start Queue
            ch.assertQueue(q.config.amqp.receiveQueue+"-"+q.config.system, q.amqpQueueOpts, function(err, newQ) {
               if (err) {
                  console.log(printdate()+" Error asserting queue on AMQP: "+q.amqpURL+", "+err);
                  conn.close();
                  retryAMQP(q);
               } else {
                  q.amqpQueue = newQ;
                  ch.bindQueue(newQ.queue, q.config.amqp.receiveExchange, q.config.system);
            
                  //exchange is ready, start input
                  q.amqpState = "open";
                  q.amqpRetry = q.config.amqp.retryMin;
                  ch.consume(q.config.amqp.receiveQueue+"-"+q.config.system, function(msg) {
                     q.lastMsg = msg.content.toString();
                     msgReceived(q,q.lastMsg);
                  }, {noAck: true});
                  ch.on('error', function(err) {
                     console.log('Channel to '+q.amqpURL+' error: '+err);
                     conn.close();
                     retryAMQP(q);
                  });
               }
            });
         }
      });
   }    
   });
}

function msgReceived(q,rcvdMessage) {
   try {
      var msg = JSON.parse(rcvdMessage);
      if (msg.type == 'unknown') {return;} //do nothing with unknown message types - probably error
      if (msg.dir == 'pc') {return;} //do nothing with messages from pc
      var dak = {msgType: msg.type, 
                 lane: msg.raw.substr(4,2),
                 msg: msg.raw.substring(10, msg.raw.length - 2)
                 };
      var m = parseInt(dak.msgType,10);
   } catch (e) {
      console.log("Invalid message ("+e+"): "+rcvdMessage);
      return;
   }
   switch (true) {
      case (m === 4): process0004(q,dak,msg); break; //reset running clock
      case (m === 5): process0005(q,dak,msg); break; //running clock
      case (m === 6): process0006(q,dak,msg); break; //TOD clock
      case (m === 9): process0009(q,dak,msg); break; //split and finish arm
      case (m === 11): process0011(q,dak,msg); break; //race number
      case (m === 12): process0012(q,dak,msg); break; //event and heat
      case (m === 16): process0016(q,dak,msg); break; //meet order
      case (100 <= m && m <= 111): processIO(q,dak,msg); break; //Raw console IO like buttons and touchpads
      case (m === 1000): process1000(q,dak,msg); break; //swimmer name and team
      case (1001 <= m && m <= 1066): processLengths(q,dak,msg); break; //Length completed status
      case (1067 <= m && m <= 1070): processBtnTimes(q,dak,msg); break; //Button times
      default: break;
   }
}

//*******************************************************
// 0004 Reset Running clock: '000400000|'
//*******************************************************
function process0004(q,dak,msg) {
   q.live.clk.race = "0.0";
   q.update["live.clk.race"] = q.live.clk.race;
}

//*******************************************************
// 0005 Running clock: '000500014|11    8:48.2  '
//*******************************************************
function process0005(q,dak,msg) {
   q.live.clk.race = dak.msg.substring(2,12);
   q.update["live.clk.race"] = q.live.clk.race;
}

//*******************************************************
// 0006 TOD clock: '000600018|01/15/201619:51:02'
//*******************************************************
function process0006(q,dak,msg) {
   q.live.clk.date = dak.msg.substring(0,10);
   q.live.clk.tod = dak.msg.substring(10,18);
   q.update["live.clk.date"] = q.live.clk.date;
   q.update["live.clk.tod"] = q.live.clk.tod;
}

//*******************************************************
// 0009 Split and Finish Arm: '000908011|100o?000020'
//*******************************************************
function process0009(q,dak,msg) {
   var lane = parseInt(dak.lane, 10) - 1; //lanes are 1-8, lane index 0-7
   if (lane >= q.config.pool.lanes) {return;} //ignore lanes greater than number used by pool
   // if (dak.msg.substr(3,1) === '-' && dak.msg.substr(9,2) === '00') {
      // clearResults(q, lane);
   // }
}

function clearResults(q, lane) {
   q.update["live.lanes["+lane+"].lengths"] = q.live.lanes[lane].lengths = "";
   q.update["live.lanes["+lane+"].place"] = q.live.lanes[lane].place = "";
   q.update["live.lanes["+lane+"].time"] = q.live.lanes[lane].time = "";
   q.update["live.lanes["+lane+"].btns[0]"] = q.live.lanes[lane].btns[0] = "";
   q.update["live.lanes["+lane+"].btns[1]"] = q.live.lanes[lane].btns[1] = "";
   q.update["live.lanes["+lane+"].btns[2]"] = q.live.lanes[lane].btns[2] = "";
   q.update["live.lanes["+lane+"].btns[3]"] = q.live.lanes[lane].btns[3] = "";
}

function clearNames(q, lane) {
   q.update["live.lanes["+lane+"].name"] = q.live.lanes[lane].name = "";
   q.update["live.lanes["+lane+"].team"] = q.live.lanes[lane].team = "";
}


//*******************************************************
// 0011 Race number: '0011 - 001100003| 30' -> CLEAR PREVIOUS RESULTS!
//*******************************************************
function process0011(q,dak,msg) {
   q.live.race.num = dak.msg.substr(0,3);
   q.update["live.race.num"] = q.live.race.num;
   for (var lane = 0; lane < q.config.pool.lanes; lane++) {
      clearResults(q, lane);
   }
}

//*******************************************************
// 0012 Event Heat: '001200007| 10 F 1'
//*******************************************************
function process0012(q,dak,msg) {
   q.live.race.e = dak.msg.substring(0,3);
   q.live.race.h = dak.msg.substring(5,7);
   q.update["live.race.e"] = q.live.race.e;
   q.update["live.race.h"] = q.live.race.h;
   q.live.race.name = "";
   q.live.race.lengths = "0";
   if (typeof q.evtLookup[q.live.race.e.trim()] !== 'undefined') {
      q.live.race.name = q.evtLookup[q.live.race.e.trim()].name;
      q.live.race.lengths = q.evtLookup[q.live.race.e.trim()].lengths;
   }
   q.update["live.race.name"] = q.live.race.name;
   q.update["live.race.lengths"] = q.live.race.lengths;
}

//*******************************************************
// 0016 Meet order: '001601302|10001 F0200011410+U0504 3:23.50 002 F0200021410+U0504  :  .   '
//*******************************************************
function process0016(q,dak,msg) {
   var evLength = parseInt(dak.msg.substr(0,2), 10);
   var name,evt, age, distance;
   for (var i=0; i < evLength; i++) {
      evt = ""+parseInt(dak.msg.substr(2+(30*i)+0,3),10);
      if (evt == "0") {break;} //All 000 is end of event list
      //Boys or Girls
      switch (dak.msg.substr(2+(30*i)+9,2)) {
         case '01': name = "Girls"; break;
         case '02': name = "Boys"; break;
         case '03': name = "Womens"; break;
         case '04': name = "Mens"; break;
         case '05': name = "Mixed"; break;
         default: name = "Unknown code("+dak.msg.substr(2+(30*i)+9,2)+")"; break;
      }
      //First age
      age = parseInt(dak.msg.substr(2+(30*i)+13,2),10);
      if (age !== 0) {
         name += " " + parseInt(dak.msg.substr(2+(30*i)+13,2),10);
         //Second age
         switch (dak.msg.substr(2+(30*i)+15,2)) {
            case '+U': name += " & Under"; break;
            case '+O': name += " & Over"; break;
            default: name += "-"+ parseInt(dak.msg.substr(2+(30*i)+15,2),10); break;
         }
      }
      //Distance
      distance = parseInt(dak.msg.substr(2+(30*i)+5,4),10);
      if (distance !== 0) {
         name += " " + distance;
         //Unit of Meaasure
         name += "Y"; //don't know what field is yards or meters
      }
      //stroke
      switch (dak.msg.substr(2+(30*i)+17,2)) {
         case '01': name += " Freestyle"; break;
         case '02': name += " Backstroke"; break;
         case '03': name += " Breaststroke"; break;
         case '04': name += " Butterfly"; break;
         case '05': name += " Individual Medley"; break;
         case '06': name += " Freestyle Relay"; break;
         case '07': name += " Medley Relay"; break;
         case '11': name += " Diving"; break;
         default: name += "Unknown stroke("+dak.msg.substr(2+(30*i)+17,2)+") "; break;
      }
      q.evtLookup[evt] = {name: name, lengths: ""+distance/q.config.pool.length, distance: distance};
   }
   q.live.race.name = "";
   q.live.race.lengths = "0";
   if (typeof q.evtLookup[q.live.race.e.trim()] !== 'undefined') {
      q.live.race.name = q.evtLookup[q.live.race.e.trim()].name;
      q.live.race.lengths = q.evtLookup[q.live.race.e.trim()].lengths;
   }
   q.update["live.race.name"] = q.live.race.name;
   q.update["live.race.lengths"] = q.live.race.lengths;
}

//*******************************************************
// 01xx Raw I/O: '010002024|19:50:55.822    9:22.65 '
//*******************************************************
function processIO(q,dak,msg) {
   var m = parseInt(dak.msgType,10);
   var state = ((m % 2) === 1); // true if message is odd
   var updateVal = {};
   //start signal
   if (110 <= m && m <= 111) {
      q.live.inputs.starter = state; //starter is true if message is 111, otherwise false
      updateVal["live.inputs.starter"] = state;
      updateImmediate(q,updateVal);
      return;
   }
   //touchpad signal
   var lane = parseInt(dak.lane, 10) - 1; //lanes are 1-8, lane index 0-7
   if (lane >= q.config.pool.lanes) {return;} //ignore lanes greater than number used by pool
   if (100 <= m && m <= 101) {
      q.live.inputs.lanes[lane].pad = state; //starter is true if message is 111, otherwise false
      updateVal["live.inputs.lanes["+lane+"].pad"] = state;
      updateImmediate(q,updateVal);
      return;
   }
   //button signal
   if (102 <= m && m <= 107) {
      var btn = Math.floor((m-102)/2);
      q.live.inputs.lanes[lane].btns[btn] = state; //starter is true if message is 111, otherwise false
      updateVal["live.inputs.lanes["+lane+"].btns["+btn+"]"] = state;
      updateImmediate(q,updateVal);
      return;
   }
}

//*******************************************************
// 1000 Swimmer name and team: '100001020|Jones, Matthew VIPR '
//*******************************************************
function process1000(q,dak,msg) {
   var lane = parseInt(dak.lane, 10) - 1; //lanes are 1-8, lane index 0-7
   if (lane >= q.config.pool.lanes) {return;} //ignore lanes greater than number used by pool
   q.live.lanes[lane].name = dak.msg.substring(0,15).trim();
   q.update["live.lanes["+lane+"].name"] = q.live.lanes[lane].name;
   q.live.lanes[lane].team = dak.msg.substring(15,20).trim();
   q.update["live.lanes["+lane+"].team"] = q.live.lanes[lane].team;
}

//*******************************************************
// 10nn Length Completed Status: '100208012|02 5:06.48  '
//*******************************************************
function processLengths(q,dak,msg) {
   var lane = parseInt(dak.lane, 10) - 1; //lanes are 1-8, lane index 0-7
   if (lane >= q.config.pool.lanes) {return;} //ignore lanes greater than number used by pool
   var lengths = dak.msgType.substr(2,2);
   var place = dak.msg.substr(0,2);
   var time = dak.msg.substr(2,8);
   
   q.live.lanes[lane].lengths = lengths;
   q.live.lanes[lane].place = place;
   q.live.lanes[lane].time = time;
   q.update["live.lanes["+lane+"].lengths"] = lengths;
   q.update["live.lanes["+lane+"].place"] = place;
   q.update["live.lanes["+lane+"].time"] = time;
}

//*******************************************************
// 1067-1070 Length Completed Status: '106704009| 6:17.77 '
//*******************************************************
function processBtnTimes(q,dak,msg) {
   var m = parseInt(dak.msgType,10) - 1067;
   var lane = parseInt(dak.lane, 10) - 1; //lanes are 1-8, lane index 0-7
   var time = dak.msg.substr(0,8);
   
   q.live.lanes[lane].btns[m] = time;
   q.update["live.lanes["+lane+"].btns["+m+"]"] = time;
}



function printdate(dateInt) {
   dateInt = dateInt || Date.now();
   var d = new Date(dateInt);
   return d.toLocaleDateString() + " " + d.toLocaleTimeString();
}

