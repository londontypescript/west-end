extends GdUnitTestSuite
## One passing test, to prove gdUnit4 runs on this Godot and writes a report.


func test_two_plus_two_is_four() -> void:
	assert_int(2 + 2).is_equal(4)
