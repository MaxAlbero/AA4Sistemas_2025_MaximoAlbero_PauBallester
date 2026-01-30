DROP PROCEDURE IF EXISTS ListReplaysForRoom;
DELIMITER //
CREATE PROCEDURE ListReplaysForRoom(IN p_room_id INT)
BEGIN
  SELECT r.id, r.room_id, r.seed, r.status, r.created_at,
         GROUP_CONCAT(rp.username ORDER BY rp.player_index SEPARATOR ', ') AS players
  FROM Replay r
  LEFT JOIN ReplayPlayer rp ON rp.replay_id = r.id
  WHERE r.room_id = p_room_id
  GROUP BY r.id
  ORDER BY r.created_at DESC;
END//
DELIMITER ;