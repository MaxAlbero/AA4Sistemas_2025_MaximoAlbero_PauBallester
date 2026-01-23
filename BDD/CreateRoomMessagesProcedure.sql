USE `mydb`;

DROP PROCEDURE IF EXISTS GetRoomMessages;

DELIMITER // 

CREATE PROCEDURE GetRoomMessages
    (room_id INT)
mainFunc:BEGIN

    IF room_id IS NULL OR room_id <= 0 THEN
        SELECT "Invalid room_id" AS error;
        LEAVE mainFunc;
    END IF;

    -- Devuelve el listado de mensajes de la sala, con el username del autor
    SELECT 
        M.id,
        M.room_id,
        M.user_id,
        M.text,
        M.createDate,
        U.username
    FROM Messages AS M
    INNER JOIN Users AS U ON U.id = M.user_id
    WHERE M.room_id = room_id
    ORDER BY M.createDate ASC;

END//

DELIMITER ;