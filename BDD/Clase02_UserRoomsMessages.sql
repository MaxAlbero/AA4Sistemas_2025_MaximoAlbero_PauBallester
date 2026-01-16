USE `mydb` ;

insert into Users(username,password) values("Primer Usuario", "1234");

select * from Users;

insert into Rooms(name) values("Room 1");

select * from Rooms;

insert into Messages (user_id,room_id,text,createDate) values(1,1,"Hola Mundo",now());

select * from Messages;

insert into Users(username,password) values("Segundo Usuario", "1234");
insert into Users(username,password) values("Tercer Usuario", "1234");

select * from Users;

insert into Rooms(name) values("Room 2");

insert into Messages (user_id, room_id, text, createDate) values(2, 1, "Pues esta guapa la casa no?", now());
insert into Messages (user_id, room_id, text, createDate) values(1, 1, "Si, ya ves a cuatro duros", now());

select * from Messages;

select * from Messages where user_id = 1;

select * from Messages where room_id = 1;

insert into Messages (user_id, room_id, text, createDate) values(1,2,"Nueva sala chavales",now());

select * from Messages where room_id = 1;
select * from Messages;

select Users.username, text, createDate from Messages
inner join Users on Messages.user_id = Users.id
where room_id = 1;

select Users.username from Rooms
left join Messages on Messages.room_id = Rooms.id
right join Users on Messages.user_id = Users.id
where Rooms.name = "Room 1"
group by user_id;

select Users.username from Messages
inner join Users on Messages.user_id = Users.id
where room_id = 1
group by user_id;

-- Asi creamos las funciones
USE `mydb` ;

create procedure GetUsersInRoom
(room_id int)
select user_id, Users.username from Messages
inner join Users on Messages.user_id = Users.id
where room_id = room_id
group by user_id
;

call GetUsersInRoom(1);

call CreateUser("UserCreadoDesdeProcedure","77777");
call CreateUser("UserCreadoDesdeProcedure","");

call Login("Pepito", "hola"); -- Hay que hacer esto