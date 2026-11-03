#include "link.h"

#include <math.h>
#include <stdio.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static double rate(double distance, const link_jammer *jammer, double sx, double sy) {
    link_rng rng;
    int i;
    int ok = 0;
    rng.rng = 0xA2E01111u;
    for (i = 0; i < 2000; i++) {
        ok += link_deliver(&rng, distance, jammer, sx, sy);
    }
    return (double)ok / 2000.0;
}

static double axis_x(double distance_m) {
    return 48.0 + (log10(distance_m) - 1.0) / 3.0 * 552.0;
}

static double axis_y(double probability) {
    return 300.0 - probability * 250.0;
}

static int write_plot(const char *path, double near, double far, double jammed, double outside) {
    FILE *out;
    int i;
    out = fopen(path, "w");
    if (out == 0) {
        return fail("could not write the link plot");
    }
    fprintf(out, "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 640 360\">\n");
    fprintf(out, "<polyline fill=\"none\" stroke=\"#d0d0d0\" stroke-width=\"2\" points=\"");
    for (i = 0; i <= 60; i++) {
        double distance = pow(10.0, 1.0 + 3.0 * i / 60.0);
        fprintf(out, "%s%.1f,%.1f", i ? " " : "", axis_x(distance), axis_y(link_success_prob(distance, 0)));
    }
    fprintf(out, "\"/>\n");
    fprintf(out, "<polyline fill=\"none\" stroke=\"#c45c26\" stroke-width=\"2\" points=\"");
    for (i = 0; i <= 60; i++) {
        double distance = pow(10.0, 1.0 + 3.0 * i / 60.0);
        fprintf(out, "%s%.1f,%.1f", i ? " " : "", axis_x(distance), axis_y(link_success_prob(distance, 60)));
    }
    fprintf(out, "\"/>\n");
    fprintf(out, "<circle cx=\"%.1f\" cy=\"%.1f\" r=\"4\" fill=\"#d0d0d0\"/>\n", axis_x(50), axis_y(near));
    fprintf(out, "<circle cx=\"%.1f\" cy=\"%.1f\" r=\"4\" fill=\"#d0d0d0\"/>\n", axis_x(5000), axis_y(far));
    fprintf(out, "<circle cx=\"%.1f\" cy=\"%.1f\" r=\"4\" fill=\"#c45c26\"/>\n", axis_x(50), axis_y(jammed));
    fprintf(out, "<circle cx=\"%.1f\" cy=\"%.1f\" r=\"4\" fill=\"#d0d0d0\"/>\n", axis_x(50), axis_y(outside));
    fprintf(out, "</svg>\n");
    if (fclose(out) != 0) {
        return fail("could not close the link plot");
    }
    printf("link_plot %s\n", path);
    return 0;
}

int main(int argc, char **argv) {
    link_jammer jammer = {0, 0, 100, 60};
    double near = rate(50, 0, 0, 0);
    double far = rate(5000, 0, 0, 0);
    double jammed = rate(50, &jammer, 0, 0);
    double outside = rate(50, &jammer, 500, 0);
    printf("success_50m %.3f\n", near);
    printf("success_5km %.3f\n", far);
    printf("success_jammed %.3f\n", jammed);
    printf("success_outside_jammer %.3f\n", outside);
    if (near < 0.9) {
        return fail("50 m link is not reliable");
    }
    if (far > 0.15) {
        return fail("5 km link is too reliable");
    }
    if (jammed > 0.2) {
        return fail("jammer did not collapse the link");
    }
    if (outside < 0.9) {
        return fail("jammer leaked outside its radius");
    }
    if (outside + 0.02 < near || outside < jammed || near < far) {
        return fail("success rate is not ordered");
    }
    if (argc > 1 && write_plot(argv[1], near, far, jammed, outside)) {
        return 1;
    }
    printf("link tests passed\n");
    return 0;
}
