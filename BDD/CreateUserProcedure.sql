USE `mydb`;

drop procedure if exists CreateUser;

delimiter // 

create procedure CreateUser
	(newUsername varchar(45), newPassword varchar(45))
mainFunc:begin

	declare existingUsers int default 0;
    
    if newUsername = "" or newPassword = "" then
		select "User or Password can't be blank or null" as error;
        leave mainFunc;
    end if;
    
    select count(*) into existingUsers from Users where Users.username = newUsername;
    
    if existingUsers != 0 then
		select "This Username exists" as error;
        leave mainFunc;
    end if;
    
    insert into Users(username,password) values(newUsername, newPassword);
    
	select count(*) into existingUsers from Users where Users.username = newUsername;
    
    if existingUsers = 0 then
		select "Error Creating User" as error;
        leave mainFunc;
    end if;
    
    select "User Created Successfully" as success;
end//