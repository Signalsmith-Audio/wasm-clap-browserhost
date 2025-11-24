using size_t = decltype(sizeof 0);

__attribute__((import_module("env"), import_name("log")))
extern void log_bytes(const char *ptr, size_t length);

__attribute__((import_module("env"), import_name("error")))
extern void error_bytes(const char *ptr, size_t length);

extern "C" {
	int foo(int v) {
		log_bytes("hello", 5);
		error_bytes("HELLO", 5);
		return v + 100;
	}
}
