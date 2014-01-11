var WSServer = require('ws').Server;
var uuid = require('node-uuid');
var async = require('async');

var server;
var clients = {};
var middlewares = {};
var stacks = {};
var rooms = {};

exports.listen = function(port, cb) {
  server = new WSServer({port: port}, cb);
  server.on('connection', function(client) {
    var clientId = uuid.v1();

    clients[clientId] = client;
    
    client.id = clientId;
    client.on('message', function(message) {
      try {
        message = JSON.parse(message);
      } catch (e) {
        console.error('Message parsing failed', message);
        return;
      }

      var event = message.e;
      var callback = message.c;
      var data = message.d || {};
      var stack = stacks[event];

      if (!stack) {
        console.error('Event does not exist', event);
        return;
      }
      
      var scope = {
        event: event
      , req: data
      , res: {}
      };

      async.forEachSeries(stack, function(fn, next) {
        fn(client, scope, next);
      }, function(err) {
        if (!callback) {
          return;
        }

        var payload = {
          c: callback
        };

        if (err) {
          payload.d = {error: parseError(err)};
        } else {
          payload.d = scope.res;
        }

        try {
          client.send(JSON.stringify(payload));
        } catch(e) {
          console.error(e);
        }
      });
    });

    client.on('close', function() {
      delete clients[client.id];

      client.rooms.forEach(function(room) {
        if (!rooms[room]) return;

        var index = rooms[room].indexOf(client.id);

        if (index >= 0) {
          rooms[room].splice(index, 1);
        }
      });
    });

    client.on('error', function(reason, code) {
      console.error('socket error: reason %s, %s', reason, code);
    });

    client.rooms = [];
    client.join = function(room) {
      rooms[room] || (rooms[room] = []);
      rooms[room].push(client.id);
      
      if (!~client.rooms.indexOf(room)) {
        client.rooms.push(room);
      }
    };

    client.leave = function(room) {
      if (!rooms[room]) return;

      var roomIndex = client.rooms.indexOf(room);
      var clientIndex = rooms[room].indexOf(client.id);

      if (roomIndex >= 0) {
        client.rooms.splice(roomIndex, 1);
      }
      if (clientIndex >= 0) {
        rooms[room].splice(clientIndex, 1);
      }
    };

    client.broadcast = function(room, event, data) {
      if (!rooms[room]) return;

      var payload = JSON.stringify({
        e: event
      , d: data
      });

      rooms[room].forEach(function(clientId) {
        if (clientId != client.id) {
          try {
            clients[clientId].send(payload);
          } catch (e) {
            console.error(e);
          }
        }
      });
    };
  });
};

exports.on = function(events, middleware) {
  events.push || (events = [events]);
  events.forEach(function(event) {
    stacks[event] || (stacks[event] = []);
    stacks[event].push(middleware);
  });
};

function parseError(err) {
  var result = {
    name: err.name
  , message: err.message
  };
  if (err.data) {
    result.data = err.data;
  }
  return result;
}
