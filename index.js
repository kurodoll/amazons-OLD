var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http, {
  'pingInterval': 2000,
  'pingTimeout': 5000
});

let id = 0;       // Used to keep a unique serial for each user that connects
let users = {};   // Stores user information, with their id as the key
let sockets = {}; // Stores client sockets, again with user id as the key

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

  // Game state information for when a game begins
  let player1_id;
  let player2_id;

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
    player1_id = user_id;
    player2_id = opponent_id;

    let pieces_fixed = JSON.parse(users[opponent_id].game_settings.pieces);
    for (let i = 0; i < pieces_fixed.length; i++) {
      if (pieces_fixed[i].owner == 0) {
        pieces_fixed[i].owner = player1_id;
      }
      else {
        pieces_fixed[i].owner = player2_id;
      }
    }

    // Notify both players of the participating players' IDs, and who is starting player
    if (sockets[player1_id] && sockets[player2_id]) {
      sockets[player1_id].emit('game_starting', {
        p1: player1_id,
        p2: player2_id,
        opponent_name: users[player2_id].username,
        starting_player: true,
        board_size: users[opponent_id].game_settings.board_size,
        pieces: pieces_fixed });

      sockets[player2_id].emit('game_starting', {
        p1: player1_id,
        p2: player2_id,
        opponent_name: users[player1_id].username,
        starting_player: false,
        board_size: users[opponent_id].game_settings.board_size,
        pieces: pieces_fixed });
    }
  })

  // Used to sync who is player 1 and who is player 2 between both players of a match
  socket.on('set_players', (game_data) => {
    player1_id = game_data.p1;
    player2_id = game_data.p2;
  })

  // Syncs new board data to both players of a match
  socket.on('board', (board) => {
    if (sockets[player1_id] && sockets[player2_id]) {
      sockets[player1_id].emit('board', board);
      sockets[player2_id].emit('board', board);
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
