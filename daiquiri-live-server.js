var config = require("./"+process.argv[2]).config;
var daiquiriDecode = require("./daiquiri-live-decode.js");
var repl = require('repl');
var express = require('express');
var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);

var poolTimer = new daiquiriDecode.DaiquiriLive(config);
//Allows port to be set by environment variable, otherwise uses port from config file
config.httpPort = process.env.PORT || config.httpPort;

server.listen(config.httpPort);
app.use(express.static(__dirname + '/public'));

io.on('connection', function (socket) {
   socket.on('live', function () {
      socket.emit('live', poolTimer.live);
   });
});

//Create timing system event handlers
poolTimer.on("update", function(msg) {
   io.emit('update', msg);
});
poolTimer.on("updateIO", function(msg) {
   io.emit('updateIO', msg);
});
poolTimer.on("live", function(msg) {
   io.emit('live', msg);
});

//Create a remote node REPL instance so you can telnet directly to this server
var local = repl.start("daiquiri-live-server> ");
//Adding objects to the local REPL's context.
local.context.poolTimer = poolTimer;
local.context.app = app;

