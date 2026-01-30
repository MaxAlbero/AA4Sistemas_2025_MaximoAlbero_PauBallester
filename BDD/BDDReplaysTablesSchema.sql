-- Esquema de replays para mydb
-- Guarda metadatos del replay, participantes y la secuencia de eventos (payload JSON)

USE `mydb`;

-- Replays: una sesión/grabación de gameplay reproducible
CREATE TABLE IF NOT EXISTS `Replays` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `room_id` INT UNSIGNED NULL,
  `owner_user_id` INT UNSIGNED NULL,
  `title` VARCHAR(100) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at` DATETIME NULL,
  `duration_ms` INT UNSIGNED NULL,
  `notes` TEXT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_replays_room` (`room_id`),
  INDEX `idx_replays_owner` (`owner_user_id`),
  CONSTRAINT `fk_replays_rooms`
    FOREIGN KEY (`room_id`) REFERENCES `Rooms`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_replays_users`
    FOREIGN KEY (`owner_user_id`) REFERENCES `Users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ReplayParticipants: participantes (usuarios o jugadores) en el replay
CREATE TABLE IF NOT EXISTS `ReplayParticipants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `replay_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NULL,       -- Si el jugador corresponde a un usuario del sistema
  `player_id` INT NULL,              -- playerId proveniente del juego (si aplica)
  `player_name` VARCHAR(64) NULL,    -- playerName (si aplica)
  `joined_at` DATETIME NULL,
  `left_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_participants_replay` (`replay_id`),
  INDEX `idx_participants_user` (`user_id`),
  CONSTRAINT `fk_participants_replay`
    FOREIGN KEY (`replay_id`) REFERENCES `Replays`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_participants_user`
    FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ReplayEvents: Secuencia ordenada de eventos para reconstruir el gameplay
-- event_type: GRID_SETUP, GRID_UPDATE, JOIN, LEAVE, CUSTOM...
-- payload: JSON (almacenado como LONGTEXT para compatibilidad)
CREATE TABLE IF NOT EXISTS `ReplayEvents` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `replay_id` INT UNSIGNED NOT NULL,
  `seq` INT UNSIGNED NOT NULL,              -- orden del evento dentro del replay
  `event_type` ENUM('GRID_SETUP','GRID_UPDATE','JOIN','LEAVE','CUSTOM') NOT NULL,
  `payload` LONGTEXT NOT NULL,              -- JSON con el contenido del evento
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_replay_seq` (`replay_id`, `seq`),
  INDEX `idx_events_replay` (`replay_id`),
  INDEX `idx_events_type` (`event_type`),
  CONSTRAINT `fk_events_replay`
    FOREIGN KEY (`replay_id`) REFERENCES `Replays`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;-- Tabla principal de replays
CREATE TABLE IF NOT EXISTS Replay (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  seed VARCHAR(32) NOT NULL,
  status ENUM('recording','completed') DEFAULT 'recording',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Jugadores que participaron en el replay
CREATE TABLE IF NOT EXISTS ReplayPlayer (
  id INT AUTO_INCREMENT PRIMARY KEY,
  replay_id INT NOT NULL,
  user_id INT NOT NULL,
  player_index INT NOT NULL, -- 0 o 1
  username VARCHAR(64) NOT NULL,
  FOREIGN KEY (replay_id) REFERENCES Replay(id) ON DELETE CASCADE,
  INDEX idx_replay_player (replay_id, player_index)
) ENGINE=InnoDB;

-- Inputs consecutivos (ordenados por seq) con offset temporal desde el inicio
CREATE TABLE IF NOT EXISTS ReplayInput (
  id INT AUTO_INCREMENT PRIMARY KEY,
  replay_id INT NOT NULL,
  seq INT NOT NULL,                     -- contador consecutivo
  player_id INT NOT NULL,               -- user_id del jugador que hizo el input
  action VARCHAR(32) NOT NULL,          -- 'left'|'right'|'rotate'|'softDropStart'|'softDropEnd'
  ts_offset_ms INT NOT NULL,            -- milisegundos desde el inicio del replay
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (replay_id) REFERENCES Replay(id) ON DELETE CASCADE,
  INDEX idx_replay_seq (replay_id, seq)
) ENGINE=InnoDB;

-- Procedimientos opcionales (puedes usar INSERT directos si prefieres)
DROP PROCEDURE IF EXISTS CreateReplay;
DELIMITER //
CREATE PROCEDURE CreateReplay(IN p_room_id INT, IN p_seed VARCHAR(32))
BEGIN
  INSERT INTO Replay (room_id, seed, status) VALUES (p_room_id, p_seed, 'recording');
  SELECT LAST_INSERT_ID() AS replay_id;
END//
DELIMITER ;

DROP PROCEDURE IF EXISTS AddReplayPlayer;
DELIMITER //
CREATE PROCEDURE AddReplayPlayer(IN p_replay_id INT, IN p_user_id INT, IN p_player_index INT, IN p_username VARCHAR(64))
BEGIN
  INSERT INTO ReplayPlayer (replay_id, user_id, player_index, username)
  VALUES (p_replay_id, p_user_id, p_player_index, p_username);
END//
DELIMITER ;

DROP PROCEDURE IF EXISTS AddReplayInput;
DELIMITER //
CREATE PROCEDURE AddReplayInput(IN p_replay_id INT, IN p_seq INT, IN p_player_id INT, IN p_action VARCHAR(32), IN p_ts_offset_ms INT)
BEGIN
  INSERT INTO ReplayInput (replay_id, seq, player_id, action, ts_offset_ms)
  VALUES (p_replay_id, p_seq, p_player_id, p_action, p_ts_offset_ms);
END//
DELIMITER ;