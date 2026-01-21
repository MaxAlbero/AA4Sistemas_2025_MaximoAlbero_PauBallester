USE `mydb`;

drop procedure if exists Login;

delimiter // 

create procedure Login
	(username varchar(45), password varchar(45))
mainFunc:begin
    
	declare existingUsers int default 0;
    
    if username = "" or password = "" then
		select "User or Password can't be blank or null" as error;
        leave mainFunc;
    end if;
    
    select count(*) into existingUsers from Users where Users.username = newUsername;
    
	if existingUsers = 0 then
		select "Wrong Username or Password" as error;
        leave mainFunc;
    end if;
    
    
end//