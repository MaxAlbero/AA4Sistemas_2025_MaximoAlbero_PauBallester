using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class NodeGrid : MonoBehaviour
{
    [Serializable]
    public class Node
    {
        public enum JewelType
        {
            None = 0,
            Red = 1,
            Green = 2,
            Blue = 3,
            Yellow = 4,
            Orange = 5,
            Purple = 6,
            Shiny = 7
        }

        public int x, y;
        public JewelType type;
        public Node(JewelType type, int x, int y)
        {
            this.type = type;
            this.x = x;
            this.y = y;
        }
    }
    
    [Serializable]
    public class Grid
    {
	    [Serializable]
	    public class Column
	    {
		    public List<Node> nodes = new ();
	    }
	    
	    public List<Column> columns = new ();

	    [SerializeField]
	    private int _playerId;
	    public int PlayerId => _playerId;
	    
	    [SerializeField]
	    private string _playerName;
	    public string PlayerName => _playerName;

        public Grid(GridSetup gridSetup)
        {
	        _playerId = gridSetup.playerId;
	        _playerName = gridSetup.playerName;

            for (int x = 0; x < gridSetup.sizeX; x++)
	        {
		        columns.Add(new ());
	            for (int y = 0; y < gridSetup.sizeY; y++)
	            {
		            columns[x].nodes.Add(new Node(Node.JewelType.None,x, y));
	            }
	        }
	    }

	    public Node GetNode(int x, int y)
	    {
		    return columns[x].nodes[y];
	    }
    }
    
    [Serializable]
    public class GridUpdate
    {
        public int playerId;
        public string playerName;
        public List<Node> updatedNodes;
    }

    [Serializable]
    public class GridSetup
    {
        public int playerId;
        public string playerName;
        public int sizeX;
        public int sizeY;
    }

    private Grid _grid;

    public void SetupGrid(GridSetup gridSetup)
    {
	    //TODO Add Code Here
	    /*
	        This function must be called from the server connection script.
	        Here you need to implement the necessary logic so that your visual grid implementation for setup the grid
	    */
	    _grid = new Grid(gridSetup);
	}

	public void UpdateGrid(GridUpdate gridUpdate)
	{
	    //TODO Add Code Here
	    /*
	        This function must be called from the server connection script.
	        Here you need to implement the necessary logic so that your visual grid implementation is updated and the changes can be displayed.

	        It is recommended to add variables to the classes defined above to facilitate integration.
	     */
    }

    private void Start()
    {
        //The code shown below is an example of how to convert GridUpdate objects to JSON and vice versa.

        SetupGrid(new()
        {
	        playerId = 0,
	        playerName = "P1",
	        sizeX = 6,
	        sizeY = 12
        });

        string json = JsonUtility.ToJson(_grid);
        
        Debug.Log(json);

        Grid g = JsonUtility.FromJson<Grid>(json);

        GridUpdate update = new()
        {
	        playerId = 0,
	        playerName = "P1",
	        updatedNodes = new()
        };
        
        update.updatedNodes.Add(new Node(Node.JewelType.Red,0,1));
        update.updatedNodes.Add(new Node(Node.JewelType.Green,0,2));
        update.updatedNodes.Add(new Node(Node.JewelType.Blue,0,3));
        update.updatedNodes.Add(new Node(Node.JewelType.None,0,4));
        
        string json2 = JsonUtility.ToJson(update);
        
        Debug.Log(json2);

        GridUpdate update2 = JsonUtility.FromJson<GridUpdate>(json2);
    }
    
}
