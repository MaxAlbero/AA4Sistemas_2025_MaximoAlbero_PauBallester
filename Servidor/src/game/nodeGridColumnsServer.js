// Server-authoritative Columns engine using NodeGrid structures.
// GridSetup: { playerId, playerName, sizeX, sizeY }
// GridUpdate: { playerId, playerName, updatedNodes: [{ type, x, y }] }

const Jewel = {
  None: 0,
  Red: 1,
  Green: 2,
  Blue: 3,
  Yellow: 4,
  Orange: 5,
  Purple: 6,
  Shiny: 7
};
const JEWELS = [Jewel.Red, Jewel.Green, Jewel.Blue, Jewel.Yellow, Jewel.Orange, Jewel.Purple];

class NodeGridColumnsServer {
  constructor(opts) {
    opts = opts || {};
    this.tickMsNormal = Number(opts.tickMs || 500);
    this.tickMsSoft = 100;

    this.sizeX = 0;
    this.sizeY = 0;
    this.playerId = 0;
    this.playerName = "P1";
    this.grid = []; // [x][y] -> Jewel

    // Falling column state
    this.falling = {
      x: 0,
      yTop: -3,        // top segment y index (can be negative before appearing)
      jewels: [Jewel.Red, Jewel.Green, Jewel.Blue],
      softDrop: false,
      prevCells: []    // previous occupied cells to clear on move
    };

    this._interval = null;

    // Callbacks
    this.onSetup = null;   // (GridSetup)
    this.onUpdate = null;  // (GridUpdate)
    this.onEnd = null;     // ()
  }

  provideSetup(gridSetup) {
    if (!gridSetup || !Number.isFinite(gridSetup.sizeX) || !Number.isFinite(gridSetup.sizeY)) {
      throw new Error("Invalid GridSetup");
    }
    this.sizeX = Number(gridSetup.sizeX);
    this.sizeY = Number(gridSetup.sizeY);
    this.playerId = Number(gridSetup.playerId || 0);
    this.playerName = String(gridSetup.playerName || "P1");

    // Init grid
    this.grid = [];
    for (let x = 0; x < this.sizeX; x++) {
      const col = [];
      for (let y = 0; y < this.sizeY; y++) col.push(Jewel.None);
      this.grid.push(col);
    }

    // Spawn first falling column
    this._spawnNewColumn();

    if (this.onSetup) {
      this.onSetup({
        playerId: this.playerId,
        playerName: this.playerName,
        sizeX: this.sizeX,
        sizeY: this.sizeY
      });
    }
    // Also emit a full snapshot once (viewer may join late)
    const full = this.getFullUpdate();
    if (this.onUpdate) this.onUpdate(full);
  }

  getFullUpdate() {
    const updatedNodes = [];
    for (let x = 0; x < this.sizeX; x++) {
      for (let y = 0; y < this.sizeY; y++) {
        updatedNodes.push({ type: this.grid[x][y], x, y });
      }
    }
    // Also include falling column cells if visible
    const fallCells = this._currentFallingCells();
    fallCells.forEach(c => {
      if (c.y >= 0 && c.y < this.sizeY) {
        updatedNodes.push({ type: c.type, x: c.x, y: c.y });
      }
    });
    return { playerId: this.playerId, playerName: this.playerName, updatedNodes };
  }

  start() {
    if (this.sizeX <= 0 || this.sizeY <= 0) throw new Error("Call provideSetup first");

    const tick = () => {
      const update = this.step();
      if (update && this.onUpdate) this.onUpdate(update);
    };
    this._interval = setInterval(tick, this._tickMs());
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    if (this.onEnd) this.onEnd();
  }

  applyInput(action) {
    // action: 'left' | 'right' | 'rotate' | 'softDropStart' | 'softDropEnd'
    if (!this._canMove()) return;

    switch (action) {
      case "left":
        this._tryShift(-1);
        break;
      case "right":
        this._tryShift(1);
        break;
      case "rotate":
        // Rotate jewels order: top->middle->bottom->top
        const j = this.falling.jewels;
        this.falling.jewels = [j[2], j[0], j[1]];
        // Refresh visible cells immediately
        this._refreshFallingVisual();
        break;
      case "softDropStart":
        this.falling.softDrop = true;
        this._retimeInterval();
        break;
      case "softDropEnd":
        this.falling.softDrop = false;
        this._retimeInterval();
        break;
    }
  }

  step() {
    // Move down by one if possible, else lock and resolve
    const updateNodes = [];

    // Clear previous falling visuals
    this.falling.prevCells.forEach(c => {
      if (c.y >= 0 && c.y < this.sizeY) updateNodes.push({ type: Jewel.None, x: c.x, y: c.y });
    });

    // Attempt to move down
    if (this._canFallOne()) {
      this.falling.yTop += 1;
      // Draw new falling cells
      const cells = this._currentFallingCells();
      this.falling.prevCells = cells;
      cells.forEach(c => {
        if (c.y >= 0 && c.y < this.sizeY) updateNodes.push({ type: c.type, x: c.x, y: c.y });
      });

      return { playerId: this.playerId, playerName: this.playerName, updatedNodes: updateNodes };
    }

    // Can't move: lock into grid
    const lockCells = this._currentFallingCells();
    lockCells.forEach(c => {
      if (c.y >= 0 && c.y < this.sizeY) {
        this.grid[c.x][c.y] = c.type;
        updateNodes.push({ type: c.type, x: c.x, y: c.y });
      }
    });

    // Resolve matches and gravity
    const cleared = this._clearMatches();
    cleared.forEach(c => updateNodes.push({ type: Jewel.None, x: c.x, y: c.y }));
    const grav = this._applyGravity();
    grav.forEach(c => updateNodes.push({ type: this.grid[c.x][c.y], x: c.x, y: c.y }));

    // Spawn new column
    this._spawnNewColumn();
    // Show new falling cells (if visible)
    this.falling.prevCells.forEach(c => {
      if (c.y >= 0 && c.y < this.sizeY) updateNodes.push({ type: c.type, x: c.x, y: c.y });
    });

    return { playerId: this.playerId, playerName: this.playerName, updatedNodes: updateNodes };
  }

  // Helpers

  _tickMs() {
    return this.falling.softDrop ? this.tickMsSoft : this.tickMsNormal;
  }

  _retimeInterval() {
    if (!this._interval) return;
    clearInterval(this._interval);
    const tick = () => {
      const update = this.step();
      if (update && this.onUpdate) this.onUpdate(update);
    };
    this._interval = setInterval(tick, this._tickMs());
  }

  _spawnNewColumn() {
    this.falling.x = Math.floor(this.sizeX / 2);
    this.falling.yTop = -3;
    this.falling.jewels = [
      JEWELS[Math.floor(Math.random() * JEWELS.length)],
      JEWELS[Math.floor(Math.random() * JEWELS.length)],
      JEWELS[Math.floor(Math.random() * JEWELS.length)],
    ];
    this.falling.prevCells = this._currentFallingCells();
  }

  _currentFallingCells() {
    // Cells are vertically consecutive: top, mid, bottom
    const x = this.falling.x;
    const yTop = this.falling.yTop;
    const [t, m, b] = this.falling.jewels;
    return [
      { x, y: yTop,     type: t },
      { x, y: yTop + 1, type: m },
      { x, y: yTop + 2, type: b },
    ];
  }

  _canMove() {
    // If any visible part is above grid top, still allow rotation/shift as long as target cells free
    return true;
  }

  _tryShift(dx) {
    const targetX = this.falling.x + dx;
    if (targetX < 0 || targetX >= this.sizeX) return;
    const yTop = this.falling.yTop;
    // Check occupancy for visible parts (y in 0..sizeY-1)
    for (let i = 0; i < 3; i++) {
      const y = yTop + i;
      if (y >= 0 && y < this.sizeY) {
        if (this.grid[targetX][y] !== Jewel.None) return; // blocked
      }
    }
    this.falling.x = targetX;
    this._refreshFallingVisual();
  }

  _refreshFallingVisual() {
    // Immediately emit current falling cells as update (clear prev, draw new)
    const updateNodes = [];
    this.falling.prevCells.forEach(c => {
      if (c.y >= 0 && c.y < this.sizeY) updateNodes.push({ type: Jewel.None, x: c.x, y: c.y });
    });
    const cells = this._currentFallingCells();
    this.falling.prevCells = cells;
    cells.forEach(c => {
      if (c.y >= 0 && c.y < this.sizeY) updateNodes.push({ type: c.type, x: c.x, y: c.y });
    });
    if (this.onUpdate) this.onUpdate({ playerId: this.playerId, playerName: this.playerName, updatedNodes: updateNodes });
  }

  _canFallOne() {
    const x = this.falling.x;
    const yTopNext = this.falling.yTop + 1;
    // Check if bottom of column would collide
    const yBottomNext = yTopNext + 2;
    if (yBottomNext < 0) return true; // still above grid, can fall
    if (yBottomNext >= this.sizeY) return false; // would go beyond bottom

    // If the bottom cell is within grid and occupied, cannot fall
    if (this.grid[x][yBottomNext] !== Jewel.None) return false;

    // Also ensure mid cell not colliding when enters grid
    const midY = yTopNext + 1;
    if (midY >= 0 && midY < this.sizeY && this.grid[x][midY] !== Jewel.None) return false;

    const topY = yTopNext;
    if (topY >= 0 && topY < this.sizeY && this.grid[x][topY] !== Jewel.None) return false;

    return true;
  }

  _clearMatches() {
    const toClear = [];
    // Vertical trios
    for (let x = 0; x < this.sizeX; x++) {
      for (let y = 0; y <= this.sizeY - 3; y++) {
        const a = this.grid[x][y], b = this.grid[x][y + 1], c = this.grid[x][y + 2];
        if (a !== Jewel.None && a === b && b === c) {
          toClear.push({ x, y }, { x, y: y + 1 }, { x, y: y + 2 });
        }
      }
    }
    // Clear them
    toClear.forEach(({ x, y }) => this.grid[x][y] = Jewel.None);
    return toClear;
  }

  _applyGravity() {
    const moved = [];
    for (let x = 0; x < this.sizeX; x++) {
      let writeY = this.sizeY - 1;
      for (let y = this.sizeY - 1; y >= 0; y--) {
        const val = this.grid[x][y];
        if (val !== Jewel.None) {
          if (y !== writeY) {
            this.grid[x][writeY] = val;
            this.grid[x][y] = Jewel.None;
            moved.push({ x, y: writeY });
          }
          writeY--;
        }
      }
    }
    return moved;
  }
}

module.exports = { NodeGridColumnsServer, Jewel };