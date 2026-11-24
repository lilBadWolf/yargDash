// yarg-broadcast.dylib: lets YARG's UDP Data Stream work on macOS.
//
// YARG broadcasts its data stream to 255.255.255.255 without setting SO_BROADCAST on the socket.
// Windows lets that through; macOS refuses it (EACCES), so YARG logs "Error sending UDP packet"
// ~88 times a second and yargDash never hears it. This library is loaded into YARG at launch
// (DYLD_INSERT_LIBRARIES, see yarg/start-yarg.sh) and turns SO_BROADCAST on for YARG's UDP sockets.
// It only adds that permission; nothing else changes and YARG's files are not modified.
//
//   clang -dynamiclib -arch arm64 -arch x86_64 -O2 -o yarg-broadcast.dylib broadcast-fix.c
#include <sys/socket.h>
#include <netinet/in.h>

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
  allow_broadcast(fd);
  return connect(fd, addr, len);
}

static ssize_t lc_sendto(int fd, const void *buf, size_t n, int flags, const struct sockaddr *to, socklen_t tolen) {
  allow_broadcast(fd);
  return sendto(fd, buf, n, flags, to, tolen);
}

__attribute__((used)) static const struct { const void *replacement, *original; } interposers[]
  __attribute__((section("__DATA,__interpose"))) = {
  { (const void *)lc_socket, (const void *)socket },
  { (const void *)lc_connect, (const void *)connect },
  { (const void *)lc_sendto, (const void *)sendto },
};
