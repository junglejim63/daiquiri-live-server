var urlHost = window.location.host;
urlHost = urlHost.toLowerCase().replace('localhost','127.0.0.1');
var socket = io(urlHost); //set this to the ip address of your node.js server

//*************************************************
// angular controller
//*************************************************
var app = angular.module("myApp", ['ngSanitize', 'ngAnimate']);

app.controller("AngularController", ['$scope', '$sce', function($scope, $sce) {
   //for debugging access to $scope:
   window.MYSCOPE = $scope;

   //create objects to hold socket.io emitted values
   $scope.live = {};   
   setInterval(function () {
      $scope.$apply();
   }, 250)
   
   //event handlers for received objects
   socket.on('live', function(live) {
      Object.assign($scope.live,live);
      // console.log('Live received');
      $scope.$apply();
   });
   socket.on('update', function(list) {
      $scope.updateList(list);
      $scope.$apply();
   });
   socket.on('updateIO', function(list) {
      $scope.updateList(list);
      var id; //default case where list is { 'live.inputs.starter': true }
      var startRE = /live\.inputs\.starter/;
      var padRE = /live\.inputs\.lanes\[(\d+)\]\.pad/;
      var btnRE = /live\.inputs\.lanes\[(\d+)\]\.btns\[(\d+)\]/;
      var result;
      for (var prop in list) {
         id = "";
         if (list[prop]) { //flash if input is true
            if (result=prop.match(startRE)) { //list is { 'live.inputs.starter': true }
               id = "STARTER";
            } else if (result=prop.match(padRE)) { //list like { 'live.inputs.lanes[0].pad': true }
               id = "TP-" + (parseInt(result[1],10));
            } else if (result=prop.match(btnRE)) { //list like { 'live.inputs.lanes[4].btns[0]': true }
               id = "B"+(parseInt(result[2],10)+1)+"-" + (parseInt(result[1],10));
            } else {
               break;
            }
            $scope.flashRed(id);
         }
      }
      $scope.$apply();
   });
   
   $scope.updateList = function(list) {
      //ex list: { 'live.lanes[6].lengths': '02', 'live.lanes[6].place': '01', 'live.lanes[6].time': '   23.65' }
      for (var prop in list) {
         try {
            // console.log("$scope."+prop + " = list['" + prop + "']");
            eval("$scope."+prop + " = list['" + prop + "']");
         } catch (e) {
            console.error("Error ("+e+") writing property "+prop);
         }
      }
   }
   $scope.laneSwimmerHTML = function(lane) {
      var txt = "<strong>"+(lane+1)+"</strong>&nbsp;";
      if ($scope.live.lanes[lane].name.length > 1) {
         txt += "<small>"+$scope.live.lanes[lane].name;
         txt += " ("+$scope.live.lanes[lane].team+")</small>";
      }
      return $sce.trustAsHtml(txt);
   }
   
   $scope.placeLength = function(lane) {
      var places = ["1<sup>st</sup>","2<sup>nd</sup>","3<sup>rd</sup>","4<sup>th</sup>",
                    "5<sup>th</sup>","6<sup>th</sup>","7<sup>th</sup>","8<sup>th</sup>",
                    "9<sup>th</sup>","10<sup>th</sup>","11<sup>th</sup>","12<sup>th</sup>"];
      var place = parseInt($scope.live.lanes[lane].place,10);
      if (isNaN(place)) {return "";}
      var t = places[place-1];
      var lengths = parseInt($scope.live.lanes[lane].lengths,10);
      if (isNaN(lengths)) {return t;}
      return $sce.trustAsHtml(t+" ("+lengths+")");
   }
   
   $scope.padHTML = function(lane) {
      var txt = "&nbsp;";
      if ($scope.live.lanes[lane].time.length > 1) {
         txt = $scope.live.lanes[lane].time;
      }
      return $sce.trustAsHtml(txt);
   }
   
   $scope.buttonHTML = function(btn,lane) {
      var txt = "&nbsp;";
      if ($scope.live.lanes[lane].btns[btn].length > 1) {
         var label = ['B1: ', 'B2: ', 'B3: ', 'BK: '];
         txt = label[btn]+$scope.live.lanes[lane].btns[btn];
      }
      return $sce.trustAsHtml(txt);
   }
   
    var timerIncInterval = 100;
   setInterval(function () {
      $scope.incTimer();
   }, timerIncInterval)
   
   $scope.incTimer = function() {
      try {
         if ($scope.live.clk.race == '0.0') {
            if ($scope.live.clk.race != $("#runningClock").text()){
               $("#runningClock").text("0.0");
            }
            return;
         }
      } catch (e) {
         console.error("cannot read property clk.race");
         return;
      }
      //get current timer value
      var curTimerHTML = $("#runningClock").text();
      var curTimer = $scope.live.clk.race;
      //parse out mins and seconds, then add interval
      var times = curTimer.split(":");
      var sec = parseFloat(times.pop());
      sec += (times.length > 0) ? parseInt(times.pop(),10)*60 : 0;
      sec += timerIncInterval/1000;
      sec = sec % (100*60);
      //reassemble in text string
      var min = Math.floor(sec/60);
      var txt = (min > 0) ? min + ":" : "";
      txt += ("00" + (sec % 60).toFixed(1)).slice(-4);
      //write back to span
      $scope.live.clk.race = txt;
      $("#runningClock").text(txt);
   }
    
   $scope.flashRed = function(id) {
      $("#"+id).addClass("flash-red");
      setTimeout(function() {$("#"+id).removeClass("flash-red");}, 500);
   }
   
   //Request latest data from server both when the page loads and when it is shown (for mobile support)
   socket.emit('live');
   refreshOnVisible('live');
   window.addEventListener('pageshow', function(event) {
      console.log('pageshow:');
      console.log(event);
      socket.emit('live');
   });
}]);

function refreshOnVisible(emitTag) {
   // Set the name of the hidden property and the change event for visibility
   var pageHidden, visibilityChange; 
   if (typeof document.hidden !== "undefined") { // Opera 12.10 and Firefox 18 and later support 
      pageHidden = "hidden";
      visibilityChange = "visibilitychange";
   } else if (typeof document.mozHidden !== "undefined") {
      pageHidden = "mozHidden";
      visibilityChange = "mozvisibilitychange";
   } else if (typeof document.msHidden !== "undefined") {
      pageHidden = "msHidden";
      visibilityChange = "msvisibilitychange";
   } else if (typeof document.webkitHidden !== "undefined") {
      pageHidden = "webkitHidden";
      visibilityChange = "webkitvisibilitychange";
   }
   // Handle page visibility change
   try {
      document.addEventListener(visibilityChange, function(event) {
         if (!document[pageHidden]) {
            console.log('visibility change:');
            console.log(event);
            socket.emit(emitTag);
         }
      }, false);
   }  catch(e) {console.error("Could not add event listener for visibility change: "+e);}
}
