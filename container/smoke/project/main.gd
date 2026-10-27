extends Node2D
## Smoke scene script. It draws nothing: the red rectangle is in the scene,
## so a blank frame means rendering failed, not this script.

var _counts: Dictionary[String, int] = {}


func _ready() -> void:
	var names: Array[String] = []
	for child in get_children():
		names.append(String(child.name))
	var count := func(items: Array[String]) -> int: return items.size()
	_counts["children"] = count.call(names)
	print("smoke scene ready: %d children" % _counts["children"])
