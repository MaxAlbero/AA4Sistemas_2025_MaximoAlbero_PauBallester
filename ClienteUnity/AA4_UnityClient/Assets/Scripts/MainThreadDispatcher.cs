using System;
using System.Collections.Generic;
using UnityEngine;

public class MainThreadDispatcher : MonoBehaviour
{
    private static MainThreadDispatcher _instance;
    private static readonly Queue<Action> _executionQueue = new Queue<Action>();
    private static bool _applicationIsQuitting = false;

    public static MainThreadDispatcher Instance
    {
        get
        {
            if (_applicationIsQuitting)
            {
                Debug.LogWarning("Application is quitting. MainThreadDispatcher no disponible.");
                return null;
            }

            if (_instance == null)
            {
                // Buscar si ya existe en la escena
                _instance = FindObjectOfType<MainThreadDispatcher>();

                if (_instance == null)
                {
                    // Crear nuevo GameObject
                    var go = new GameObject("MainThreadDispatcher");
                    _instance = go.AddComponent<MainThreadDispatcher>();
                    DontDestroyOnLoad(go);
                    Debug.Log("MainThreadDispatcher creado");
                }
            }
            return _instance;
        }
    }

    void Awake()
    {
        if (_instance == null)
        {
            _instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else if (_instance != this)
        {
            Destroy(gameObject);
        }
    }

    void Update()
    {
        lock (_executionQueue)
        {
            while (_executionQueue.Count > 0)
            {
                try
                {
                    var action = _executionQueue.Dequeue();
                    action?.Invoke();
                }
                catch (Exception ex)
                {
                    Debug.LogError($"Error en MainThreadDispatcher: {ex.Message}\n{ex.StackTrace}");
                }
            }
        }
    }

    public void Enqueue(Action action)
    {
        if (action == null) return;

        lock (_executionQueue)
        {
            _executionQueue.Enqueue(action);
        }
    }

    public static void RunOnMainThread(Action action)
    {
        if (action == null) return;

        var instance = Instance;
        if (instance != null)
        {
            instance.Enqueue(action);
        }
        else
        {
            Debug.LogWarning("MainThreadDispatcher no disponible. Acción no ejecutada.");
        }
    }

    void OnApplicationQuit()
    {
        _applicationIsQuitting = true;
    }
}