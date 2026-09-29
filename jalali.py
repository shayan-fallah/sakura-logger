"""Jalali (Hijri Shamsi) <-> Gregorian conversion.

Port of static/jalali.js (algorithm from jalaali-js, MIT, Behrang Noruzi Niya).
"""

BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635,
          2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]


def _div(a, b):
    return int(a / b)  # truncates toward zero, like JS ~~(a / b)


def _mod(a, b):
    return a - _div(a, b) * b


def _jal_cal(jy, without_leap=False):
    gy = jy + 621
    leap_j, jp, jump = -14, BREAKS[0], 0
    for jm in BREAKS[1:]:
        jump = jm - jp
        if jy < jm:
            break
        leap_j += _div(jump, 33) * 8 + _div(_mod(jump, 33), 4)
        jp = jm
    n = jy - jp
    leap_j += _div(n, 33) * 8 + _div(_mod(n, 33) + 3, 4)
    if _mod(jump, 33) == 4 and jump - n == 4:
        leap_j += 1
    leap_g = _div(gy, 4) - _div((_div(gy, 100) + 1) * 3, 4) - 150
    march = 20 + leap_j - leap_g
    if without_leap:
        return gy, march, None
    if jump - n < 6:
        n = n - jump + _div(jump + 4, 33) * 33
    leap = _mod(_mod(n + 1, 33) - 1, 4)
    if leap == -1:
        leap = 4
    return gy, march, leap


def _g2d(gy, gm, gd):
    d = (_div((gy + _div(gm - 8, 6) + 100100) * 1461, 4)
         + _div(153 * _mod(gm + 9, 12) + 2, 5) + gd - 34840408)
    return d - _div(_div(gy + 100100 + _div(gm - 8, 6), 100) * 3, 4) + 752


def _d2g(jdn):
    j = 4 * jdn + 139361631
    j = j + _div(_div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
    i = _div(_mod(j, 1461), 4) * 5 + 308
    gd = _div(_mod(i, 153), 5) + 1
    gm = _mod(_div(i, 153), 12) + 1
    gy = _div(j, 1461) - 100100 + _div(8 - gm, 6)
    return gy, gm, gd


def _j2d(jy, jm, jd):
    gy, march, _ = _jal_cal(jy, True)
    return _g2d(gy, 3, march) + (jm - 1) * 31 - _div(jm, 7) * (jm - 7) + jd - 1


def _d2j(jdn):
    gy = _d2g(jdn)[0]
    jy = gy - 621
    _, march, leap = _jal_cal(jy)
    k = jdn - _g2d(gy, 3, march)
    if k >= 0:
        if k <= 185:
            return jy, 1 + _div(k, 31), _mod(k, 31) + 1
        k -= 186
    else:
        jy -= 1
        k += 179
        if leap == 1:
            k += 1
    return jy, 7 + _div(k, 30), _mod(k, 30) + 1


def to_jalali(gy, gm, gd):
    return _d2j(_g2d(gy, gm, gd))


def to_gregorian(jy, jm, jd):
    return _d2g(_j2d(jy, jm, jd))
