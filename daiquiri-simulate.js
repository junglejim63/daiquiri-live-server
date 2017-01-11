//*******************************************************
// Sends saved messages to amqp queue to simulate daktronics console
//   Usage: $ node DAKQuery_simulate.js config.js 
//*******************************************************
//Load required modules
var rl = require('readline');
var fs = require('fs');
var amqp = require('amqplib/callback_api');
var repl = require('repl');
var cfg = require("./"+process.argv[2]).config; //get configuration file

//object to hold working variables
var vars = {
   config: cfg,
   i: 0,
   lines : [],
   timing : {lastLogTime: null, speed: cfg.speed},
   fileOpen : false,
   nextProcess : null,
   nextLine : null,
   lrState : "closed",
   sent: 0,
   lineReader: null
};
var repl = repl.start({
  prompt: 'Daktronics Communication Simulator> ',
  input: process.stdin,
  output: process.stdout
});
repl.context.vars = vars;

//*******************************************************
//AMQP Port Setup
//*******************************************************
var ampqChannel;
var amqpURL = 'amqp://'+vars.config.amqp.user+':'+vars.config.amqp.pass+'@'+vars.config.amqp.locator;
amqp.connect(amqpURL, function(err, conn) {
   if (err) {
      console.log(printdate()+" Error creating connection, exiting: "+err);
      process.exit();
   } else {
      conn.createChannel(function(err, ch) {
         if (err) {
            console.log(printdate()+" Error creating channel, exiting: "+err);
            process.exit();
         } else {
            ampqChannel = ch;
            startInput();
            ch.on('error', function(err) {
               console.error('Channel to '+amqpURL+' error: '+err);
               process.exit();
            });
         }
      });
   }    
});

function startInput() {
   //attempt to open input file
   var rs = fs.createReadStream(vars.config.source);
   vars.fileOpen = true;
   vars.lineReader = rl.createInterface({input: rs});
   vars.lrState = "running";
   vars.lineReader.on('line', function (line) {
      vars.lines.push(line);
      if (vars.lines.length > 1000 && vars.lrState == "running") { //limit number of lines in memory to process
         vars.lineReader.pause();
         vars.lrState = "paused";
      } 
      if (vars.nextProcess === null) { //first line has been received
         vars.nextProcess = setTimeout(processLine, 1000);
      }
   });
   vars.lineReader.on('close', function (line) {
      console.log("File reading is complete");
      vars.lrState = "closed";
      //
   });
}

function processLine() {
   var nextLogTime = null;
   //send next Line if it exists
   if (vars.nextLine !== null) {
      ampqChannel.publish(vars.config.amqp.exchange, vars.config.system, new Buffer(vars.nextLine));
      var o = JSON.parse(vars.nextLine);
      var d = new Date(o.rxTime);
      console.log("Line: "+vars.sent+" | "+ d.toLocaleTimeString() +" | "+o.dir+" cmd: "+o.type+" | "+o.raw);
      vars.sent++;
      vars.timing.lastLogTime = JSON.parse(vars.nextLine).rxTime;
      vars.nextLine = null;
   }
   //get next line from the lines array
   while (vars.lines.length > 0 && vars.nextLine === null) {
      vars.nextLine = vars.lines.shift();
      try {
         nextLogTime = JSON.parse(vars.nextLine).rxTime;
      } catch (e) {
         console.log("Invalid line: "+ vars.nextLine);
         vars.nextLine = null;
      }
   }
   //restart linereader if paused and lines array is small enough
   if (vars.lines.length < 500 && vars.lrState == "paused") {
      vars.lineReader.resume();
      vars.lrState = "running";
   }
   //if no new line, do not reschedule.  Else schedule based on difference in RXTime between message just sent and new line
   if (vars.nextLine === null) {
      vars.nextProcess = null; //don't schedule next run, nothing to send
      if (vars.lrState == "closed") {process.exit();}
   } else {
      var timeout = (vars.timing.lastLogTime === null) ? 0 : (nextLogTime - vars.timing.lastLogTime)/vars.timing.speed;
      timeout = Math.floor((timeout < 50) ? 0 : timeout);  //50 ms is threshhold Low Cutoff
      // console.log("Line: "+vars.sent+" Timeout: "+timeout+" LR: "+vars.lrState+ " QL: "+vars.lines.length);
      nextProcess = setTimeout(processLine, timeout);
   }
}

function printdate(dateInt) {
   dateInt = dateInt || Date.now();
   var d = new Date(dateInt);
   return d.toLocaleDateString() + " " + d.toLocaleTimeString();
}

