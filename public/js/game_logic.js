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

module.exports = {
  validMove: validMove
};
