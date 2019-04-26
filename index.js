const express = require('express');
const path = require('path');

const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
  'pingInterval': 2000,
  'pingTimeout': 5000
});

app.use(express.static(path.join(__dirname, 'public')));

let id = 0;       // Used to keep a unique serial for each user that connects
let users = {};   // Stores user information, with their id as the key
let sockets = {}; // Stores client sockets, again with user id as the key

// Game state information for games
let games = {};
let game_serial = 0;

let default_game_settings = {
  board_size: 10,
  pieces: JSON.stringify([
    {type: 'amazon', x: 3, y: 0, owner: 0, selected: false},
    {type: 'amazon', x: 6, y: 0, owner: 0, selected: false},
    {type: 'amazon', x: 0, y: 3, owner: 0, selected: false},
    {type: 'amazon', x: 9, y: 3, owner: 0, selected: false},
    {type: 'amazon', x: 3, y: 9, owner: 1, selected: false},
    {type: 'amazon', x: 6, y: 9, owner: 1, selected: false},
    {type: 'amazon', x: 0, y: 6, owner: 1, selected: false},
    {type: 'amazon', x: 9, y: 6, owner: 1, selected: false}
  ])
}

app.get('/', function(req, res) {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', function(socket) {
  // "Generate" an ID for this user
  const user_id = id;
  id += 1;

  // Send the user their ID
  socket.emit('id', user_id);

  // Latency test
  socket.on('ping', function(start_time) {
    socket.emit('pong', start_time);
  });

  // User has submitted a username for themself
  socket.on('username', (username) => {
    // Initialize user's information
    users[user_id] = {}
    users[user_id].username = username;
    sockets[user_id] = socket;

    io.emit('users', users); // Send the updated user list out to all connected users

    // Game settings management
    users[user_id].game_settings = default_game_settings;
    socket.emit('game_settings', users[user_id].game_settings);
  })

  socket.on('game_settings', function(game_settings) {
    users[user_id].game_settings = game_settings;
  });

  // User has requested to play a match against another user, so notify that user
  socket.on('request_play', (opponent_id) => {
    // Send the info of the requesting user to the other user
    if (sockets[opponent_id]) {
      sockets[opponent_id].emit('request_to_play', { username: users[user_id].username, id: user_id });
    }
  })

  // User has accepted a match requested by another user.
  // If the user declines, no notification is sent to the requester
  socket.on('accept_play', (opponent_id) => {
    opponent_id = parseInt(opponent_id);

    socket.emit('end_game');
    sockets[opponent_id].emit('end_game');

    // Init server-side game data
    game_id = game_serial;
    game_serial += 1;

    games[game_id] = {
      p1: user_id,
      p2: opponent_id,
      turn: user_id
    };

    console.log('Game#' + game_id + ' created (' + users[games[game_id].p1].username + '#' + games[game_id].p1 + ' vs ' + users[games[game_id].p2].username + '#' + games[game_id].p2 + ')');

    // Assign pieces to the actual IDs of the players
    let pieces_fixed = JSON.parse(users[opponent_id].game_settings.pieces);
    for (let i = 0; i < pieces_fixed.length; i++) {
      if (pieces_fixed[i].owner == 0) {
        pieces_fixed[i].owner = games[game_id].p1;
      }
      else {
        pieces_fixed[i].owner = games[game_id].p2;
      }
    }

    // Notify both players of the participating players' IDs, and who is starting player
    if (sockets[games[game_id].p1] && sockets[games[game_id].p2]) {
      const game_data = {
        game_id: game_id,
        p1: games[game_id].p1,
        p2: games[game_id].p2,
        p1_name: users[games[game_id].p1].username,
        p2_name: users[games[game_id].p2].username,
        starting_player: games[game_id].p1,
        board_size: users[opponent_id].game_settings.board_size,
        pieces: pieces_fixed };

      sockets[games[game_id].p1].emit('game_starting', game_data);
      sockets[games[game_id].p2].emit('game_starting', game_data);
    }
  })

  // Syncs new board data to both players of a match
  socket.on('board', (data) => {
    if (sockets[games[data.game_id].p1] && sockets[games[data.game_id].p2]) {
      sockets[games[data.game_id].p1].emit('board', data);
      sockets[games[data.game_id].p2].emit('board', data);
    }
  })

  socket.on('turn_done', (data) => {
    let turn;

    if (data.player_id == games[data.game_id].turn && data.player_id == games[data.game_id].p1) {
      games[data.game_id].turn = games[data.game_id].p2;
    }
    else {
      games[data.game_id].turn = games[data.game_id].p1;
    }

    if (sockets[games[data.game_id].p1] && sockets[games[data.game_id].p2]) {
      let data = { game_id: data.game_id, player_id: games[data.game_id].turn };

      sockets[games[data.game_id].p1].emit('turn', data);
      sockets[games[data.game_id].p2].emit('turn', data);
    }
  })

  // User has disconnected, so clean up all their data to prevent memory leaking
  socket.on('disconnect', () => {
    delete users[user_id];
    delete sockets[user_id];

    // Update the live user list
    io.emit('users', users);
  });
});

http.listen(process.env.PORT || 3000, function() {
  console.log('listening on *:' + (process.env.PORT || 3000));
});
