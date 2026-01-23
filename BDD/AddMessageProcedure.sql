USE `mydb`;

DROP PROCEDURE IF EXISTS AddMessage;

DELIMITER // 

CREATE PROCEDURE AddMessage
    (inRoomId INT, inUserId INT, inText VARCHAR(128))
mainFunc:BEGIN

    DECLARE roomExists INT DEFAULT 0;
    DECLARE userExists INT DEFAULT 0;

    -- Validaciones de entrada (mismo estilo que CreateUser/CreateRoom)
    IF inRoomId IS NULL OR inRoomId <= 0 THEN
        SELECT "Invalid room_id" AS error;
        LEAVE mainFunc;
    END IF;

    IF inUserId IS NULL OR inUserId <= 0 THEN
        SELECT "Invalid user_id" AS error;
        LEAVE mainFunc;
    END IF;

    IF inText IS NULL OR inText = "" THEN
        SELECT "Message can't be blank or null" AS error;
        LEAVE mainFunc;
    END IF;

    IF LENGTH(inText) > 128 THEN
        SELECT "Message too long" AS error;
        LEAVE mainFunc;
    END IF;

    -- Comprobar existencia de sala y usuario
    SELECT COUNT(*) INTO roomExists FROM Rooms WHERE Rooms.id = inRoomId;
    IF roomExists = 0 THEN
        SELECT "Room not found" AS error;
        LEAVE mainFunc;
    END IF;

    SELECT COUNT(*) INTO userExists FROM Users WHERE Users.id = inUserId;
    IF userExists = 0 THEN
        SELECT "User not found" AS error;
        LEAVE mainFunc;
    END IF;

    -- Insertar mensaje (createDate es VARCHAR en el esquema actual; se usa NOW() como en los ejemplos del repo)
    INSERT INTO Messages(user_id, room_id, text, createDate)
    VALUES (inUserId, inRoomId, inText, NOW());

    -- Respuesta de éxito (mismo estilo que CreateUser/CreateRoom)
    SELECT "Message Added Successfully" AS success;

END//

DELIMITER ;