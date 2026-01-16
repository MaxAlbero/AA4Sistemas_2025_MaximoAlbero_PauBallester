using SocketIOClient;
List<string> messages = new List<string>();

var socket = new SocketIO("http://192.168.1.75:3000/");

socket.On("chat message", response =>
{
    string message = response.GetValue<string>();

    if(message != "")
    {
        messages.Add(message);
        Console.Clear();

        foreach(string m in messages)
        {
            Console.WriteLine(m);
        }
    }
});

socket.OnConnected += (sender, EndOfStreamException) =>
{
    Console.WriteLine("Conexión establecida");
};

await  socket.ConnectAsync();

string closeChatKey = "QuitChat";
string newMessage = "";

do
{
    newMessage = Console.ReadLine() ?? "";
    if(newMessage != "" && newMessage != closeChatKey)
    {
        await socket.EmitAsync("chat message", newMessage);
    }
} while (newMessage != closeChatKey);