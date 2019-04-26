const express = require('express');
const path = require('path');

const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
  'pingInterval': 2000,
  'pingTimeout': 5000
});

const game_logic = require(__dirname + '/public/js/game_logic.js');

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

app.get('/rulesets', function(req, res) {
  res.sendFile(__dirname + '/rulesets.html');
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
    if (!users[user_id]) {
      // Initialize user's information
      users[user_id] = {}
    }

    users[user_id].username = username;
    sockets[user_id] = socket;

    io.emit('users', users); // Send the updated user list out to all connected users

    // Game settings management
    if (!users[user_id].game_settings) {
      users[user_id].game_settings = default_game_settings;
    }

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
    let game_id = game_serial;
    game_serial += 1;

    let players = [ 
      { id: user_id, username: users[user_id].username },
      { id: opponent_id, username: users[opponent_id].username } ];

    let added = [];

    // Assign pieces to the actual IDs of the players
    let pieces_fixed = JSON.parse(users[opponent_id].game_settings.pieces);
    for (let i = 0; i < pieces_fixed.length; i++) {
      if (pieces_fixed[i].owner == 0) {
        pieces_fixed[i].owner = players[0].id;
      }
      else if (pieces_fixed[i].owner >= 998 && !added.includes(pieces_fixed[i].owner)) {
        players.push({ id: pieces_fixed[i].owner, username: 'AI' });
        added.push(pieces_fixed[i].owner);
      }
      else if (pieces_fixed[i].owner == 1) {
        pieces_fixed[i].owner = players[1].id;
      }
    }

    games[game_id] = {
      players: players,
      turn: user_id
    };

    console.log('Game#' + game_id + ' created (' + games[game_id].players[0].username + '#' + games[game_id].players[0].id + ' vs ' + games[game_id].players[1].username + '#' + games[game_id].players[1].id + ')');

    // Notify both players of the participating players' IDs, and who is starting player
    if (sockets[games[game_id].players[0].id] && sockets[games[game_id].players[1].id]) {
      const game_data = {
        game_id: game_id,
        players: players,
        starting_player: players[0].id,
        board_size: users[opponent_id].game_settings.board_size,
        pieces: pieces_fixed };

      sockets[games[game_id].players[0].id].emit('game_starting', game_data);
      sockets[games[game_id].players[1].id].emit('game_starting', game_data);
    }
  })

  // Syncs new board data to both players of a match
  socket.on('board', (data) => {
    data.board_info = getBoardRegions(data.board);
    data.board_info.points = calculatePoints(data.board, data.board_info.regions);

    games[data.game_id].board_data = data;

    if (sockets[games[data.game_id].players[0].id] && sockets[games[data.game_id].players[1].id]) {
      sockets[games[data.game_id].players[0].id].emit('board', data);
      sockets[games[data.game_id].players[1].id].emit('board', data);
    }
  })

  socket.on('turn_done', (data) => {
    for (let i = 0; i < games[data.game_id].players.length; i++) {
      if (games[data.game_id].players[i].id == data.player_id) {
        if (i + 1 < games[data.game_id].players.length) {
          games[data.game_id].turn = games[data.game_id].players[i + 1].id;
        }
        else {
          games[data.game_id].turn = games[data.game_id].players[0].id;
        }
      }
    }

    while (games[data.game_id].turn >= 998) {
      let moving_id = games[data.game_id].turn;

      let moves = getAIMove(games[data.game_id].turn, games[data.game_id].board_data);

      if (moves != null) {
        let move = moves.move;
        let burn = moves.burn;

        let piece = games[data.game_id].board_data.amazons[move.piece_index];

        games[data.game_id].board_data.board[move.x][move.y] = games[data.game_id].board_data.amazons[move.piece_index];
        games[data.game_id].board_data.board[piece.x][piece.y] = { type: 'empty' };
        games[data.game_id].board_data.board[move.x][move.y].x = move.x;
        games[data.game_id].board_data.board[move.x][move.y].y = move.y;
        games[data.game_id].board_data.board[burn.x][burn.y] = { type: 'burned' };
      }

      for (let i = 0; i < games[data.game_id].players.length; i++) {
        if (games[data.game_id].players[i].id == moving_id) {
          if (i + 1 < games[data.game_id].players.length) {
            games[data.game_id].turn = games[data.game_id].players[i + 1].id;
          }
          else {
            games[data.game_id].turn = games[data.game_id].players[0].id;
          }

          break;
        }
      }
    }

    if (sockets[games[data.game_id].players[0].id] && sockets[games[data.game_id].players[1].id]) {
      sockets[games[data.game_id].players[0].id].emit('board', games[data.game_id].board_data);
      sockets[games[data.game_id].players[1].id].emit('board', games[data.game_id].board_data);
    }

    if (sockets[games[data.game_id].players[0].id] && sockets[games[data.game_id].players[1].id]) {
      let send_data = { game_id: data.game_id, player_id: games[data.game_id].turn };

      sockets[games[data.game_id].players[0].id].emit('turn', send_data);
      sockets[games[data.game_id].players[1].id].emit('turn', send_data);
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

function getBoardRegions(board) {
  let free_tiles = []

  for (let x = 0; x < board.length; x++) {
    for (let y = 0; y < board[x].length; y++) {
      if (board[x][y].type != 'burned') {
        free_tiles.push({ x: x, y: y, region: 0 });
      }
    }
  }

  let regions = 0;

  while (true) {
    let done = true;

    for (let i = 0; i < free_tiles.length; i++) {
      if (free_tiles[i].region == 0) {
        regions += 1;
        free_tiles[i].region = regions;

        done = false;
        break;
      }
    }

    if (done) {
      break;
    }

    let changed = 1;

    while (changed > 0) {
      changed = 0;

      for (let i = 0; i < free_tiles.length; i++) {
        if (free_tiles[i].region == 0) {
          for (let j = 0; j < free_tiles.length; j++) {
            if (free_tiles[j].region != 0) {
              let distance_x = Math.abs(free_tiles[i].x - free_tiles[j].x);
              let distance_y = Math.abs(free_tiles[i].y - free_tiles[j].y);

              if (distance_x <= 1 && distance_y <= 1) {
                free_tiles[i].region = free_tiles[j].region;
                changed += 1;
              }
            }
          }
        }
      }
    }
  }

  return {
    regions: free_tiles,
    n_regions: regions };
}

function calculatePoints(board, regions) {
  let players_present = {};
  let region_sizes = {};

  for (let i = 0; i < regions.length; i++) {
    if (board[regions[i].x][regions[i].y].type == 'amazon') {
      if (!players_present[regions[i].region]) {
        players_present[regions[i].region] = []
      }

      players_present[regions[i].region].push(board[regions[i].x][regions[i].y]);
    }

    if (region_sizes[regions[i].region]) {
      region_sizes[regions[i].region] += 1;
    }
    else {
      region_sizes[regions[i].region] = 1;
    }
  }

  let points = {};
  let points_potential = {};

  for (let region in players_present) {
    let players_counted = [];

    for (let i = 0; i < players_present[region].length; i++) {
      if (players_counted.includes(players_present[region][i].owner)) {
        continue;
      }
      else {
        players_counted.push(players_present[region][i].owner);
      }

      if (points_potential[players_present[region][i].owner]) {
        points_potential[players_present[region][i].owner] += region_sizes[region];
      }
      else {
        points_potential[players_present[region][i].owner] = region_sizes[region];
      }
    }

    if (players_counted.length == 1) {
      if (points[players_counted[0]]) {
        points[players_counted[0]] += region_sizes[region];
      }
      else {
        points[players_counted[0]] = region_sizes[region];
      }
    }
  }

  return {
    points: points,
    points_potential: points_potential
  }
}

function getAIMove(ai_id, board_data) {
  let possible_moves = [];

  for (let i = 0; i < board_data.amazons.length; i++) {
    if (board_data.amazons[i].owner == ai_id) {
      for (let j = 0; j < board_data.board_info.regions.length; j++) {
        if (game_logic.validMove(
          { x: board_data.amazons[i].x, y: board_data.amazons[i].y },
          { x: board_data.board_info.regions[j].x, y: board_data.board_info.regions[j].y },
          board_data.board
        )) {
          possible_moves.push({
            x: board_data.board_info.regions[j].x,
            y: board_data.board_info.regions[j].y,
            piece_index: i
          });
        }
      }
    }
  }

  if (possible_moves.length == 0) {
    return null;
  }

  let move = possible_moves[Math.floor(Math.random() * possible_moves.length)];
  let burnable_tiles = [];

  for (let j = 0; j < board_data.board_info.regions.length; j++) {
    if (game_logic.validMove(
      { x: move.x, y: move.y },
      { x: board_data.board_info.regions[j].x, y: board_data.board_info.regions[j].y },
      board_data.board
    )) {
      burnable_tiles.push({
        x: board_data.board_info.regions[j].x,
        y: board_data.board_info.regions[j].y
      });
    }
  }

  if (burnable_tiles.length == 0) {
    return null;
  }

  let burn = burnable_tiles[Math.floor(Math.random() * burnable_tiles.length)];

  return {
    move: move,
    burn: burn
  };
}
