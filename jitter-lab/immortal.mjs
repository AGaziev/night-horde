// Lab-only preload: bots never take damage, so runs last long enough to build a dense horde.
import { Room } from '../app/server/game.js';
Room.prototype.hurtPlayer = function () {};
