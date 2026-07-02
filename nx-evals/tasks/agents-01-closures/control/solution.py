def adder(n):
    return lambda x: x + n


def greet(name, greeting="Hello"):
    return greeting + ", " + name


def count(*items):
    return len(items)
