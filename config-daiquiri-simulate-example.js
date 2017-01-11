var config = {
   system: "site", // site ID
   source: "./log/test.log",
   amqp: {locator: "queue.cloudamqp.com/user", user: "username", pass: "password", 
          exchange: "daiquiri-adapter", exType: 'direct', retryMin: 1000, retryMax: 30000},
   speed: 1
};
module.exports.config = config;
