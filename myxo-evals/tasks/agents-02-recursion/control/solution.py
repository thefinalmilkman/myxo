def sum_to(n):
    if n <= 0:
        return 0
    return n + sum_to(n - 1)


def fib(n):
    if n == 0:
        return 0
    if n == 1:
        return 1
    return fib(n - 1) + fib(n - 2)


def gcd(a, b):
    if b == 0:
        return a
    return gcd(b, a % b)
