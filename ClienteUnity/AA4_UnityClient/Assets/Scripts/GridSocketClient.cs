using System;
using UnityEngine;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class GridSocketClient : MonoBehaviour
{
    [Header("Server")]
    public string serverUrlLink = "http://localhost:3000";

    [Header("Auth (must exist in DB)")]
    public string username = "user"; // Rellena en el Inspector con un usuario real
    public string password = "user";           // Rellena en el Inspector con su contraseña

    [Header("Room")]
    public int roomId = 1;
    public bool joinFirstRoomOnLogin = false;

    [Header("Grid Target")]
    public NodeGrid nodeGrid;

    private SocketIOUnity socket;

    // Flags para simular "Once" sin Off
    private bool awaitingLoginResponse = false;
    private bool awaitingJoinResponse = false;

    private void Start()
    {
        if (nodeGrid == null)
        {
            Debug.LogError("[GridSocketClient] NodeGrid reference is null.");
            return;
        }

        var uri = new Uri(serverUrlLink);
        socket = new SocketIOUnity(uri);

        socket.OnConnected += (s, e) =>
        {
            Debug.Log("[GridSocketClient] Connected");
            TryLogin();
        };

        socket.OnDisconnected += (s, e) =>
        {
            Debug.Log("[GridSocketClient] Disconnected");
        };

        socket.On("setupGrid", response =>
        {
            string json = ExtractPayloadString(response);
            if (string.IsNullOrEmpty(json))
            {
                Debug.LogWarning("[GridSocketClient] setupGrid payload empty");
                return;
            }

            NodeGrid.GridSetup setup;
            try { setup = JsonUtility.FromJson<NodeGrid.GridSetup>(json); }
            catch (Exception ex) { Debug.LogError("[GridSocketClient] setupGrid parse error: " + ex.Message); return; }

            MainThreadDispatcher.RunOnMainThread(() =>
            {
                if (nodeGrid != null) nodeGrid.SetupGrid(setup);
            });
        });

        socket.On("updateGrid", response =>
        {
            string json = ExtractPayloadString(response);
            if (string.IsNullOrEmpty(json))
            {
                Debug.LogWarning("[GridSocketClient] updateGrid payload empty");
                return;
            }

            NodeGrid.GridUpdate update;
            try { update = JsonUtility.FromJson<NodeGrid.GridUpdate>(json); }
            catch (Exception ex) { Debug.LogError("[GridSocketClient] updateGrid parse error: " + ex.Message); return; }

            MainThreadDispatcher.RunOnMainThread(() =>
            {
                if (nodeGrid != null) nodeGrid.UpdateGrid(update);
            });
        });

        socket.On("ChatRoomsData", response =>
        {
            if (!joinFirstRoomOnLogin || roomId > 0) return;

            try
            {
                var arr = JArray.Parse(response.ToString());
                if (arr.Count > 0)
                {
                    int firstId = arr[0]["id"]?.Value<int>() ?? 0;
                    if (firstId > 0)
                    {
                        Debug.Log("[GridSocketClient] Auto-joining first room id=" + firstId);
                        roomId = firstId;
                        JoinRoom(roomId);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[GridSocketClient] ChatRoomsData parse warning: " + ex.Message);
            }
        });

        socket.On("LoginResponse", response =>
        {
            if (!awaitingLoginResponse) return;
            awaitingLoginResponse = false;

            try
            {
                var token = TryGetToken(response);
                JObject o = token as JObject;
                if (o == null && token is JArray arr && arr.Count > 0) o = arr[0] as JObject;

                if (o == null)
                {
                    Debug.LogError("[GridSocketClient] LoginResponse payload no es objeto. Raw=" + response.ToString());
                    return;
                }

                var status = o["status"]?.ToString();
                var successText = o["success"]?.ToString();
                var errorText = o["error"]?.ToString();
                var message = o["message"]?.ToString();

                if (status == "success" || !string.IsNullOrEmpty(successText))
                {
                    Debug.Log("[GridSocketClient] Login OK. Raw=" + o.ToString(Newtonsoft.Json.Formatting.None));
                    if (roomId > 0) JoinRoom(roomId);
                    else if (!joinFirstRoomOnLogin)
                        Debug.LogWarning("[GridSocketClient] roomId <= 0 y joinFirstRoomOnLogin=false. No se unirá a ninguna sala.");
                }
                else
                {
                    string reason = !string.IsNullOrEmpty(errorText)
                        ? errorText
                        : (!string.IsNullOrEmpty(message) ? message : "Unknown");
                    Debug.LogError("[GridSocketClient] Login failed: " + reason + ". Raw=" + o.ToString(Newtonsoft.Json.Formatting.None));
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("[GridSocketClient] LoginResponse parse error: " + ex.Message + " Raw=" + response.ToString());
            }
        });

        socket.On("JoinRoomResponse", response =>
        {
            if (!awaitingJoinResponse) return;
            awaitingJoinResponse = false;

            try
            {
                var token = TryGetToken(response);
                JObject o = token as JObject;
                if (o == null && token is JArray arr && arr.Count > 0) o = arr[0] as JObject;

                if (o == null)
                {
                    Debug.LogError("[GridSocketClient] JoinRoomResponse payload no es objeto. Raw=" + response.ToString());
                    return;
                }

                var status = o["status"]?.ToString();
                if (status != "success")
                {
                    var message = o["message"]?.ToString() ?? "Unknown";
                    Debug.LogError("[GridSocketClient] JoinRoom failed: " + message + ". Raw=" + o.ToString(Newtonsoft.Json.Formatting.None));
                    return;
                }
                var role = o["role"]?.ToString() ?? "spectator";
                Debug.Log("[GridSocketClient] Joined room " + roomId + " as " + role);
            }
            catch (Exception ex)
            {
                Debug.LogError("[GridSocketClient] JoinRoomResponse parse error: " + ex.Message + " Raw=" + response.ToString());
            }
        });

        socket.Connect();
    }

    private void OnDestroy()
    {
        try { socket?.Dispose(); } catch { /* ignore */ }
    }

    private void TryLogin()
    {
        var u = (username ?? "").Trim();
        var p = (password ?? "").Trim();

        if (string.IsNullOrEmpty(u) || string.IsNullOrEmpty(p))
        {
            Debug.LogError("[GridSocketClient] Username/password en blanco. Rellena el componente en el Inspector.");
            return;
        }

        awaitingLoginResponse = true;

        // CAMBIO: enviar dos argumentos (username, password) en lugar de objeto
        Debug.Log("[GridSocketClient] Emit LoginRequest args username='" + u + "' password='(hidden)'");
        socket.EmitAsync("LoginRequest", u, p);
    }
    private void JoinRoom(int id)
    {
        awaitingJoinResponse = true;

        // CAMBIO: enviar el roomId como argumento numérico simple
        Debug.Log("[GridSocketClient] Emit JoinRoomRequest roomId=" + id);
        socket.EmitAsync("JoinRoomRequest", id);
    }
    private JToken TryGetToken(SocketIOResponse response)
    {
        try
        {
            var token = response.GetValue<JToken>();
            if (token != null && token.Type == JTokenType.String)
            {
                var s = token.Value<string>();
                if (!string.IsNullOrEmpty(s)) return JToken.Parse(s);
            }
            return token ?? JToken.Parse(response.ToString());
        }
        catch
        {
            return JToken.Parse(response.ToString());
        }
    }

    private string ExtractPayloadString(SocketIOResponse response)
    {
        try { return response.GetValue<string>(); }
        catch
        {
            try
            {
                var token = response.GetValue<JToken>();
                return token.ToString(Newtonsoft.Json.Formatting.None);
            }
            catch { return response.ToString(); }
        }
    }
}