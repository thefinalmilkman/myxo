# A plain Perl module — Myxo calls these subs as fenced capabilities via plcall, no knowledge of Perl required.
sub add { my ($a, $b) = @_; return $a + $b; }

sub stats {
    my @n = @{ $_[0] };
    my $s = 0; $s += $_ for @n;
    my $m = $n[0]; for (@n) { $m = $_ if $_ > $m; }
    return { sum => $s, max => $m, n => scalar(@n) };
}
sub echo { return $_[0]; }   # identity: tests value round-trip across languages
1;   # `do $file` needs a true return value
