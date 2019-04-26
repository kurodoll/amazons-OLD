$(function() {
  // ========================================================================================== //
  //                                                                          Connection Stuff //
  // ======================================================================================== //

  let socket = io();

  socket.on('pong', function(ms) {
    $('#ping').html('Latency <span id="led">' + ms + 'ms</span>');

    if (ms > 255) {
      ms = 255;
    }

    $('#led').css('border-bottom', '2px rgba(' + ms + ', ' + (255 - ms) + ', 0, .7) dotted');
  });

  socket.on('disconnect', function() {
    $('#ping').html('<span id="led">Connection Lost</span>');
    $('#led').css('border-bottom', '2px rgba(255, 0, 0, .7) dotted');

    $('#user_list').hide();
    $('#game_settings').hide();
  });

  socket.on('game_settings', function(game_settings) {
    $('#gs_board_size').val(game_settings.board_size);
    $('#gs_pieces').val(game_settings.pieces);

    $('#game_settings').show();
  });

  $('#change_game_settings').submit(function(e) {
    e.preventDefault();

    socket.emit('game_settings', {
      board_size: $('#gs_board_size').val(),
      pieces: $('#gs_pieces').val()
    });

    return false;
  });



  // ========================================================================================== //
  //                                                                    User Interaction Stuff //
  // ======================================================================================== //

  // The ID of the user. Set to -1 until we actually get our ID from the server
  let id = -1;

  // Server has sent the user their ID
  socket.on('id', function(user_id) {
    id = user_id;
  });

  // User has submitted a username
  $('#username_choose').submit(function(e) {
    e.preventDefault();
    socket.emit('username', $('#username_field').val());
    return false;
  });

  // Server has sent a list of currently online users
  socket.on('users', function(users) {
    let username_list = '';

    // Create an HTML list of online users, where each name can be clicked to request a match with them
    for (let user in users) {
      username_list += '<a id="' + user + '" href="#">' + users[user].username + '</a><br />';
    }

    // Update the user list and ensure that the box is visible, since it's hidden by default
    $('#users_online').html(username_list);
    $('#user_list').show();
  });

  // User has clicked a name in the Users Online box, meaning they want to request a match
  $('#users_online').on('click', 'a', function(e) {
    socket.emit('request_play', e.target.id); // The <a> will have the relevant user's ID as the element ID
  });

  // Someone has a requested a match with the user
  socket.on('request_to_play', function(user) {
    $('#request_box').html(user.username + ' wants to play with you! <a id="' + user.id + '" href="#">Accept</a> or <a id="decline" href="#">Decline</a>');
    $('#request_sound')[0].play();
  });

  // User has recieved a request for a match and is either accepting or declining
  $('#request_box').on('click', 'a', function(e) {
    if (e.target.id == 'decline') {
      $('#request_box').html('');
    }
    else {
      socket.emit('accept_play', e.target.id); // The <a> will have the relevant user's ID as the element ID
    }
  });



  // ========================================================================================== //
  //                                                                      Game Logic Functions //
  // ======================================================================================== //

  // Determines whether a piece can move to a certain tile
  function validMove(from, to, board) {
    // A piece can't move to its own tile
    if (from.x == to.x && from.y == to.y) {
      return false;
    }

    // Handle vertical movements (where y changes)
    if (from.x == to.x) {
      // Get the starting and ending y coordinates, ensuring that the start is lower than the end
      let start = (from.y > to.y ? to.y : from.y);
      let end = (from.y > to.y ? from.y : to.y);

      // A small hack to make things work correctly
      if (from.y < to.y) {
        start += 1;
        end += 1;
      }

      // Look through each tile along the path and ensure that it is empty
      for (let i = start; i < end; i++) {
        if (board[from.x][i].type != 'empty') {
          return false;
        }
      }

      // No obstacles, so the move is valid!
      return true;
    }

    // Handle horizontal movements (where x changes)
    if (from.y == to.y) {
      // Get the starting and ending x coordinates, ensuring that the start is lower than the end
      let start = (from.x > to.x ? to.x : from.x);
      let end = (from.x > to.x ? from.x : to.x);

      // A small hack to make things work correctly
      if (from.x < to.x) {
        start += 1;
        end += 1;
      }

      // Look through each tile along the path and ensure that it is empty
      for (let i = start; i < end; i++) {
        if (board[i][from.y].type != 'empty') {
          return false;
        }
      }

      // No obstacles, so the move is valid!
      return true;
    }
    
    // Handle diagonal movements
    if (Math.abs(from.x - to.x) == Math.abs(from.y - to.y)) {
      // We iterate over the path using delta movements
      let x_change = 1;
      let y_change = 1;

      if (from.x > to.x) {
        x_change = -1;
      }
      if (from.y > to.y) {
        y_change = -1;
      }

      let x = from.x;
      let y = from.y;

      // Look through each tile along the path and ensure that it is empty
      while (true) {
        x += x_change;
        y += y_change;

        if (board[x][y].type != 'empty') {
          return false;
        }

        if (x == to.x && y == to.y) {
          return true;
        }
      }
    }

    // No other movement types are valid, so this move mustn't be valid
    return false;
  }



  // ========================================================================================== //
  //                                                                           Game Core Logic //
  // ======================================================================================== //

  let game_id = -1;
  let app;

  socket.on('game_starting', function(game_data) {
    game_id = game_data.game_id;
    $('#start_sound')[0].play();

    // Clear any requests that are being shown
    $('#request_box').html('');


    // ----------------------------------------------------------------------------------------| INITIALIZE BOARD DATA |
    const board_size = parseInt(game_data.board_size);
    const tile_size = 40;
    let my_turn = (game_data.starting_player == id); // We get sent either true or false for this value

    if (my_turn) {
      $('#current_turn').html('<b>It is your turn!</b>');
    }
    else {
      $('#current_turn').html('It is your opponent\'s turn.');
    }

    // Populate the board as a 2D array with preset data
    let board = [];

    for (let i = 0; i < board_size; i++) {
      let column = Array(board_size).fill({ type: 'empty' }); // Each tile is represented as an object that has at least a type
      board.push(column);
    }

    // Set up the positions of the pieces, which we call Amazons
    let amazons = game_data.pieces;

    // We have an array to store the Amazons, but also place the Amazons in the board data.
    // We ensure that the data always works as a reference,
    // so that the piece data can be accessed in whichever way is more efficient
    for (let i = 0; i < amazons.length; i++) {
      board[amazons[i].x][amazons[i].y] = amazons[i];
    }

    // Set up some colours for each player
    let colours = {};
    colours[game_data.p1] = { hex: 0x00FF88, css_hex: '#00FF88', name: 'Green' };
    colours[game_data.p2] = { hex: 0x0088FF, css_hex: '#0088FF', name: 'Blue' };

    let opponent_name = (id == game_data.p1 ? game_data.p1_name : game_data.p2_name);
    $('#info').html('(Game#' + game_id + ') You are player <span style="color: ' + colours[id].css_hex + ';">' + colours[id].name + '</span>, playing against ' + opponent_name + ' - ');


    // ----------------------------------------------------------------------------------------| INITIALIZE PIXI.JS |
    app = new PIXI.Application({
      width: board_size * tile_size + 10, // The 10 is for padding purposes
      height: board_size * tile_size + 10,
      transparent: true
    });

    $('#game').html(app.view);
    app.ticker.add(delta => gameLoop(delta));

    // Graphics for the board itself
    let graphics_board = new PIXI.Graphics();
    graphics_board.lineStyle(1, 0x446688, 1);

    for (let x = 0; x < board_size; x++) {
      for (let y = 0; y < board_size; y++) {
        graphics_board.drawRect(
          5 + (x * tile_size), // The 5 is for padding purposes
          5 + (y * tile_size),
          tile_size,
          tile_size);
      }
    }

    // Graphics for the Amazon pieces
    let graphics_amazon = new PIXI.Graphics();

    // Graphics for "burned" tiles
    let graphics_burned = new PIXI.Graphics();

    // Graphics for tiles that are valid to move to
    let graphics_valid = new PIXI.Graphics();

    app.stage.addChild(graphics_board);
    app.stage.addChild(graphics_amazon);
    app.stage.addChild(graphics_burned);
    app.stage.addChild(graphics_valid);


    // ----------------------------------------------------------------------------------------| THE GAME LOOP |
    let active_piece; // The piece that moved this turn

    function gameLoop(delta) {
      // Reset all the graphics.
      // I'm not actually sure how this works so this might be wrong...
      // But it works!
      graphics_amazon.clear();
      graphics_burned.clear();
      graphics_burned.lineStyle(1, 0xFF0000, 1);
      graphics_valid.clear();
      graphics_valid.lineStyle(1, 0xFFFFFF, 1);

      for (let i = 0; i < amazons.length; i++) {
        // Set the colour of the piece depending on who it belongs to
        graphics_amazon.lineStyle(2, colours[amazons[i].owner].hex, 1);

        // If the piece is selected, fill it in with colour
        if (amazons[i].selected) {
          graphics_amazon.beginFill(colours[amazons[i].owner].hex);
        }

        graphics_amazon.drawCircle(
          5 + (amazons[i].x * tile_size) + tile_size / 2, // The 5 is for padding purposes
          5 + (amazons[i].y * tile_size) + tile_size / 2,
          tile_size / 3
        );

        if (amazons[i].selected) {
          graphics_amazon.endFill();

          // If the piece is selected, we also want to see which moves are valid
          if (!moved) {
            for (let x = 0; x < board_size; x++) {
              for (let y = 0; y < board_size; y++) {
                if (validMove({ x: amazons[i].x, y: amazons[i].y }, { x: x, y: y }, board)) {
                  graphics_valid.drawCircle(
                    5 + (x * tile_size) + tile_size / 2, // The 5 is for padding purposes
                    5 + (y * tile_size) + tile_size / 2,
                    3
                  );
                }
              }
            }
          }
        }
      }

      // If we've moved, we want to highlight squares that can be burned
      if (moved) {
        for (let x = 0; x < board_size; x++) {
          for (let y = 0; y < board_size; y++) {
            if (validMove({ x: active_piece.x, y: active_piece.y }, { x: x, y: y }, board)) {
              graphics_valid.drawRect(
                5 + (x * tile_size) + 5, // The 5 is for padding purposes
                5 + (y * tile_size) + 5,
                tile_size - 10,
                tile_size - 10
              );
            }
          }
        }
      }

      // Draw "burned" tiles
      for (let x = 0; x < board_size; x++) {
        for (let y = 0; y < board_size; y++) {
          if (board[x][y].type == 'burned') {
            graphics_burned.beginFill(0xFF0000, .1);

            graphics_burned.drawRect(
              5 + (x * tile_size), // The 5 is for padding purposes
              5 + (y * tile_size),
              tile_size,
              tile_size
            );

            graphics_burned.endFill();
          }
        }
      }
    }


    // ----------------------------------------------------------------------------------------| GAMEPLAY HANDLING |
    let moved = false; // Whether the user has moved a piece, therefore being on the second part of their turn

    // If the user clicks the game, we want to react appropriately
    $('#game').click(function(e) {
      if (my_turn) { // We only want to let the user do anything if it's actually their turn
        // Get the mouse position
        var element = $(this);
        var mouse_x = e.pageX - element.offset().left;
        var mouse_y = e.pageY - element.offset().top;

        // Determine which tile was clicked, if any
        tile_x = Math.floor((mouse_x - 10) / tile_size); // The 5 is to account for padding
        tile_y = Math.floor((mouse_y - 10) / tile_size);

        if (tile_x < 0 || tile_x >= board_size || tile_y < 0 || tile_y >= board_size) {
          // The user didn't click on a tile
          return;
        }

        if (!moved) {
          // We haven't moved yet, so we need to see whether the user selected a piece, or a spot to move
          if (board[tile_x][tile_y].type == 'amazon') {
            // The user has selected a piece
            if (board[tile_x][tile_y].owner == id) { // Make sure we own the piece
              old_state = board[tile_x][tile_y].selected;

              // Make sure all the other pieces are deselected before selecting this one
              for (let i = 0; i < amazons.length; i++) {
                amazons[i].selected = false;
              }

              board[tile_x][tile_y].selected = !old_state;
            }

            return;
          }

          // At this point, the user must be selecting a tile to move to
          for (let i = 0; i < amazons.length; i++) {
            if (amazons[i].selected) {
              if (validMove({ x: amazons[i].x, y: amazons[i].y }, { x: tile_x, y: tile_y }, board)) {
                // Update the Amazon's position, both on the board and in its internal data
                board[amazons[i].x][amazons[i].y] = { type: 'empty' };
                board[tile_x][tile_y] = amazons[i];

                board[tile_x][tile_y].x = tile_x;
                board[tile_x][tile_y].y = tile_y;

                moved = true;
                active_piece = board[tile_x][tile_y];
              }

              return;
            }
          }
        }

        // At this point, the user must be selecting a tile to burn.
        // But make sure that they've moved first
        if (moved) {
          // Make sure the user's moved piece has access to the selected tile
          if (validMove({ x: active_piece.x, y: active_piece.y }, { x: tile_x, y: tile_y }, board)) {
            board[tile_x][tile_y] = { type: 'burned' };

            moved = false;
            board[active_piece.x][active_piece.y].selected = false;

            // Since the user's turn is complete, send the updated board data to the server
            socket.emit('board', { game_id: game_id, amazons: amazons, board: board });
            socket.emit('turn_done', { game_id: game_id, player_id: id });
          }
        }
      }
    });

    // Server has sent board data, so the active user must have switched, and we need to renew our data
    socket.on('board', function(data) {
      if (data.game_id == game_id) {
        $('#piece_move_sound')[0].play();

        board = data.board;
        amazons = data.amazons;

        // We need to do this so that the object references are set correctly
        for (let i = 0; i < amazons.length; i++) {
          board[amazons[i].x][amazons[i].y] = amazons[i];
        }
      }
    });

    socket.on('turn', function(data) {
      if (data.game_id == game_id) {
        my_turn = (data.player_id == id);

        if (my_turn) {
          $('#current_turn').html('<b>It is your turn!</b>');
        }
        else {
          $('#current_turn').html('It is your opponent\'s turn.');
        }
      }
    });

    socket.on('end_game', function() {
      $('#game').unbind('click');
      $('#game').html('');
      delete app;
      $('#info').html('');
      $('#current_turn').html('');
      game_id = -1;
    });
  });
});