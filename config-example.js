var config = {
   system: "site", // site ID
   pool: {name: "Pool Name", lanes: 8, length:25},
   httpPort: 8888,
   amqp: {locator: "queue.cloudamqp.com/user", user: "user", pass: "password",
           receiveExchange: "daiquiri-adapter", receiveQueue: "daiquiri-adapter-live",  
           sendExchange: "daiquiri-commands", exType: 'direct', retryMin: 1000, retryMax: 30000},
   msg: {
      ignore: []
   },
   updatesMS: {full: 120000, partial: 500}
};
module.exports.config = config;
