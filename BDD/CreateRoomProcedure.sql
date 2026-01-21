USE `mydb`;

DROP PROCEDURE IF EXISTS CreateRoom;

DELIMITER // 

CREATE PROCEDURE CreateRoom(newRoomName VARCHAR(45))
mainFunc:BEGIN
    DECLARE existingRooms INT DEFAULT 0;
    
    IF newRoomName = "" THEN
        SELECT "Room name can't be blank" AS error;
        LEAVE mainFunc;
    END IF;
    
    SELECT COUNT(*) INTO existingRooms FROM Rooms WHERE Rooms.name = newRoomName;
    
    IF existingRooms != 0 THEN
        SELECT "This Room name already exists" AS error;
        LEAVE mainFunc;
    END IF;
    
    INSERT INTO Rooms(name) VALUES(newRoomName);
    
    SELECT COUNT(*) INTO existingRooms FROM Rooms WHERE Rooms.name = newRoomName;
    
    IF existingRooms = 0 THEN
        SELECT "Error Creating Room" AS error;
        LEAVE mainFunc;
    END IF;
    
    SELECT "Room Created Successfully" AS success, LAST_INSERT_ID() AS roomId;
END//

DELIMITER ;