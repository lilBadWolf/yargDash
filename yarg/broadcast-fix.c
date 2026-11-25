// yarg-broadcast.dylib: lets YARG's UDP Data Stream work on macOS.
//
// YARG broadcasts its data stream to 255.255.255.255 without setting SO_BROADCAST on the socket.
// Windows lets that through; macOS refuses it (EACCES), so YARG logs "Error sending UDP packet"
// ~88 times a second and yargDash never hears it. This library is loaded into YARG at launch
// (DYLD_INSERT_LIBRARIES, see yarg/start-yarg.sh) and turns SO_BROADCAST on for YARG's UDP sockets.
// It only adds that permission; nothing else changes and YARG's files are not modified.
//
// "This Mac only" (YARGDASH_STREAM_LOCAL=1): the data stream (255.255.255.255:36107, hard-coded in YARG) goes to
// 127.0.0.1 instead. Traffic that stays on this Mac needs no Local Network permission, for YARG or for yargDash;
// but then only one program on this Mac receives the stream, and no other computer does.
//
//   clang -dynamiclib -arch arm64 -arch x86_64 -O2 -o yarg-broadcast.dylib broadcast-fix.c
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <stdlib.h>
#include <string.h>

#define STREAM_PORT 36107

static int local_only(void) {
  static int on = -1;
  if (on < 0) { const char *v = getenv("YARGDASH_STREAM_LOCAL"); on = v && v[0] == '1'; }
  return on;
}

// The data stream's broadcast address, swapped for 127.0.0.1 in "this Mac only" mode (IPv4, or IPv4-mapped IPv6).
static const struct sockaddr *redirect(const struct sockaddr *a, socklen_t len, struct sockaddr_storage *tmp) {
  if (!a || !local_only()) return a;
  if (a->sa_family == AF_INET && len >= (socklen_t)sizeof(struct sockaddr_in)) {
    const struct sockaddr_in *in = (const struct sockaddr_in *)a;
    if (in->sin_addr.s_addr != htonl(INADDR_BROADCAST) || ntohs(in->sin_port) != STREAM_PORT) return a;
    struct sockaddr_in *out = (struct sockaddr_in *)tmp;
    *out = *in; out->sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    return (const struct sockaddr *)out;
  }
  if (a->sa_family == AF_INET6 && len >= (socklen_t)sizeof(struct sockaddr_in6)) {
    const struct sockaddr_in6 *in6 = (const struct sockaddr_in6 *)a;
    static const unsigned char bcast[16] = { 0,0,0,0, 0,0,0,0, 0,0,0xff,0xff, 255,255,255,255 };
    if (memcmp(&in6->sin6_addr, bcast, 16) != 0 || ntohs(in6->sin6_port) != STREAM_PORT) return a;
    struct sockaddr_in6 *out = (struct sockaddr_in6 *)tmp;
    *out = *in6; out->sin6_addr.s6_addr[12] = 127; out->sin6_addr.s6_addr[13] = 0; out->sin6_addr.s6_addr[14] = 0; out->sin6_addr.s6_addr[15] = 1;
    return (const struct sockaddr *)out;
  }
  return a;
}

static void allow_broadcast(int fd) {
  int type = 0, on = 1;
  socklen_t len = sizeof type;
  if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &len) == 0 && type == SOCK_DGRAM)
    setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &on, sizeof on);
}

static int lc_socket(int domain, int type, int protocol) {
  int fd = socket(domain, type, protocol);
  if (fd >= 0 && (domain == AF_INET || domain == AF_INET6)) allow_broadcast(fd);
  return fd;
}

static int lc_connect(int fd, const struct sockaddr *addr, socklen_t len) {
  struct sockaddr_storage tmp;
  allow_broadcast(fd);
  return connect(fd, redirect(addr, len, &tmp), len);
}

static ssize_t lc_sendto(int fd, const void *buf, size_t n, int flags, const struct sockaddr *to, socklen_t tolen) {
  struct sockaddr_storage tmp;
  allow_broadcast(fd);
  return sendto(fd, buf, n, flags, redirect(to, tolen, &tmp), tolen);
}

static ssize_t lc_sendmsg(int fd, const struct msghdr *msg, int flags) {
  allow_broadcast(fd);
  if (!msg || !msg->msg_name || !local_only()) return sendmsg(fd, msg, flags);
  struct sockaddr_storage tmp;
  struct msghdr m = *msg;
  m.msg_name = (void *)redirect((const struct sockaddr *)msg->msg_name, msg->msg_namelen, &tmp);
  return sendmsg(fd, &m, flags);
}

__attribute__((used)) static const struct { const void *replacement, *original; } interposers[]
  __attribute__((section("__DATA,__interpose"))) = {
  { (const void *)lc_socket, (const void *)socket },
  { (const void *)lc_connect, (const void *)connect },
  { (const void *)lc_sendto, (const void *)sendto },
  { (const void *)lc_sendmsg, (const void *)sendmsg },
};
