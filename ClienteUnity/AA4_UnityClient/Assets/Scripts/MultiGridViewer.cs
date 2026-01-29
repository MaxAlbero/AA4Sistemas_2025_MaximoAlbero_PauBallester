using System.Collections.Generic;
using UnityEngine;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class MultiGridViewer : MonoBehaviour
{
    public string serverUrlLink = "http://localhost:3000";

    // Prefab o referencia al componente NodeGrid (se instanciará por player)
    public NodeGrid nodeGridPrefab;

    private SocketIOUnity socket;
    private Dictionary<int, NodeGrid> gridsByPlayer = new();

    private void Start()
    {
        socket = new SocketIOUnity(new System.Uri(serverUrlLink));

        socket.OnConnected += (s, e) => Debug.Log("[MultiGridViewer] Connected");

        socket.On("setupGrid", resp =>
        {
            var setupJson = ExtractPayloadString(resp);
            var setup = JsonUtility.FromJson<NodeGrid.GridSetup>(setupJson);
            if (!gridsByPlayer.ContainsKey(setup.playerId))
            {
                var go = new GameObject($"Grid_{setup.playerId}");
                var grid = go.AddComponent<NodeGrid>();
                // Posicionar cada grid de forma distinta para que se vean las dos a la vez
                go.transform.position = new Vector3(setup.playerId == 0 ? -5f : 5f, 0f, 0f);
                grid.SetupGrid(setup);
                gridsByPlayer[setup.playerId] = grid;
            }
            else
            {
                gridsByPlayer[setup.playerId].SetupGrid(setup);
            }
        });

        socket.On("updateGrid", resp =>
        {
            var updateJson = ExtractPayloadString(resp);
            var update = JsonUtility.FromJson<NodeGrid.GridUpdate>(updateJson);
            if (gridsByPlayer.TryGetValue(update.playerId, out var grid))
            {
                grid.UpdateGrid(update);
            }
        });

        socket.Connect();
    }

    public void SendProvideSetup(int roomId, int playerId, string playerName, int sizeX, int sizeY)
    {
        var setup = new NodeGrid.GridSetup
        {
            playerId = playerId,
            playerName = playerName,
            sizeX = sizeX,
            sizeY = sizeY
        };
        // Incluye roomId junto al setup para facilitar al servidor
        var payload = new JObject
        {
            ["roomId"] = roomId,
            ["playerId"] = playerId,
            ["playerName"] = playerName,
            ["sizeX"] = sizeX,
            ["sizeY"] = sizeY
        };
        socket.EmitAsync("GameProvideSetup", payload);
    }

    private string ExtractPayloadString(SocketIOResponse response)
    {
        try { return response.GetValue<string>(); }
        catch
        {
            try { return response.GetValue<JToken>().ToString(Newtonsoft.Json.Formatting.None); }
            catch { return response.ToString(); }
        }
    }
}